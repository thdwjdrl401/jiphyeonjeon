from __future__ import annotations

from dataclasses import dataclass, fields
from io import BytesIO
from pathlib import PureWindowsPath
import stat
import struct
import unicodedata
from urllib.parse import unquote, urlsplit
from xml.etree import ElementTree
from zipfile import (
    BadZipFile,
    LargeZipFile,
    ZIP_DEFLATED,
    ZIP_STORED,
    ZipFile,
    ZipInfo,
)

from pptx import Presentation

from app.domain import InvalidPptxError, MaterialIngestionError, PptxLimitExceededError
from app.ingestion.models import ContentBlock, ParsedPresentation


_READ_BLOCK_BYTES = 1024 * 1024
_EOCD_SIGNATURE = b"PK\x05\x06"
_ZIP64_EOCD_SIGNATURE = b"PK\x06\x06"
_ZIP64_LOCATOR_SIGNATURE = b"PK\x06\x07"
_EOCD_MIN_BYTES = 22
_EOCD_MAX_SEARCH_BYTES = _EOCD_MIN_BYTES + 65_535
_REQUIRED_PARTS = frozenset(
    {
        "[Content_Types].xml",
        "_rels/.rels",
        "ppt/presentation.xml",
        "ppt/_rels/presentation.xml.rels",
    }
)
_SUPPORTED_COMPRESSION = frozenset({ZIP_STORED, ZIP_DEFLATED})
_RELATIONSHIPS_NAMESPACE = "http://schemas.openxmlformats.org/package/2006/relationships"


@dataclass(frozen=True, slots=True)
class PptxValidationLimits:
    source_max_bytes: int = 50 * 1024 * 1024
    central_directory_max_bytes: int = 16 * 1024 * 1024
    uncompressed_max_bytes: int = 200 * 1024 * 1024
    entry_max_count: int = 10_000
    entry_max_uncompressed_bytes: int = 50 * 1024 * 1024
    xml_entry_max_uncompressed_bytes: int = 10 * 1024 * 1024
    compression_ratio_max: float = 1_000.0
    slide_max_count: int = 5_000
    shape_max_count: int = 100_000
    block_max_count: int = 100_000
    text_max_chars: int = 5_000_000
    relationship_max_count: int = 100_000

    def __post_init__(self) -> None:
        if any(getattr(self, field.name) <= 0 for field in fields(self)):
            raise ValueError("PPTX validation limits must be positive")


def parse_pptx(
    source: bytes,
    *,
    limits: PptxValidationLimits = PptxValidationLimits(),
) -> ParsedPresentation:
    """Validate and parse an in-memory PPTX without extracting package members."""

    if not isinstance(source, bytes) or not source:
        raise InvalidPptxError("PPTX source must be non-empty bytes")
    if len(source) > limits.source_max_bytes:
        raise PptxLimitExceededError("PPTX source exceeds the configured size limit")

    _validate_zip_package(source, limits)
    try:
        presentation = Presentation(BytesIO(source))
        page_count = len(presentation.slides)
        if page_count > limits.slide_max_count:
            raise PptxLimitExceededError("PPTX contains too many slides")

        blocks: list[ContentBlock] = []
        shape_count = 0
        text_chars = 0
        for page, slide in enumerate(presentation.slides, start=1):
            order = 0
            for shape in slide.shapes:
                shape_count += 1
                if shape_count > limits.shape_max_count:
                    raise PptxLimitExceededError("PPTX contains too many shapes")
                if getattr(shape, "has_table", False):
                    text = _table_text(shape.table)
                    kind = "table"
                elif getattr(shape, "has_text_frame", False):
                    text = _text_frame_text(shape.text_frame)
                    kind = "text"
                else:
                    continue
                if text:
                    text_chars = _append_block(
                        blocks,
                        ContentBlock(page=page, order=order, kind=kind, text=text),
                        text_chars,
                        limits,
                    )
                    order += 1

            notes_text = _notes_text(slide)
            if notes_text:
                text_chars = _append_block(
                    blocks,
                    ContentBlock(page=page, order=order, kind="notes", text=notes_text),
                    text_chars,
                    limits,
                )

        return ParsedPresentation(page_count=page_count, blocks=tuple(blocks))
    except MaterialIngestionError:
        raise
    except MemoryError:
        raise
    except Exception as exc:
        raise InvalidPptxError("invalid PPTX package") from exc


def _append_block(
    blocks: list[ContentBlock],
    block: ContentBlock,
    text_chars: int,
    limits: PptxValidationLimits,
) -> int:
    if len(blocks) >= limits.block_max_count:
        raise PptxLimitExceededError("PPTX contains too many text blocks")
    next_text_chars = text_chars + len(block.text)
    if next_text_chars > limits.text_max_chars:
        raise PptxLimitExceededError("PPTX contains too much indexable text")
    blocks.append(block)
    return next_text_chars


def _validate_zip_package(source: bytes, limits: PptxValidationLimits) -> None:
    expected_entry_count = _preflight_zip_directory(source, limits)
    try:
        with ZipFile(BytesIO(source), allowZip64=True) as archive:
            entries = archive.infolist()
            if len(entries) != expected_entry_count:
                raise InvalidPptxError("PPTX ZIP central directory entry count is inconsistent")

            member_names: set[str] = set()
            exact_names: set[str] = set()
            declared_total = 0
            for entry in entries:
                canonical_name = _validate_entry(entry, limits)
                if canonical_name in member_names:
                    raise InvalidPptxError(
                        "PPTX ZIP contains duplicate or non-canonical member names"
                    )
                member_names.add(canonical_name)
                exact_names.add(entry.filename)
                declared_total += entry.file_size
                if declared_total > limits.uncompressed_max_bytes:
                    raise PptxLimitExceededError("PPTX ZIP exceeds the uncompressed size limit")

            missing_parts = _REQUIRED_PARTS - exact_names
            if missing_parts:
                raise InvalidPptxError("ZIP is not a complete PPTX package")

            actual_total = 0
            for entry in entries:
                if entry.is_dir():
                    continue
                actual_size = 0
                with archive.open(entry) as member:
                    while chunk := member.read(_READ_BLOCK_BYTES):
                        actual_size += len(chunk)
                        actual_total += len(chunk)
                        if actual_size > limits.entry_max_uncompressed_bytes:
                            raise PptxLimitExceededError(
                                "PPTX ZIP entry exceeds the configured size limit"
                            )
                        if actual_total > limits.uncompressed_max_bytes:
                            raise PptxLimitExceededError(
                                "PPTX ZIP exceeds the uncompressed size limit"
                            )
                if actual_size != entry.file_size:
                    raise InvalidPptxError("PPTX ZIP entry size is inconsistent")

            _validate_relationships(archive, entries, member_names, limits)
    except MaterialIngestionError:
        raise
    except (BadZipFile, LargeZipFile, RuntimeError, NotImplementedError, OSError, EOFError) as exc:
        raise InvalidPptxError("invalid PPTX ZIP package") from exc


def _preflight_zip_directory(source: bytes, limits: PptxValidationLimits) -> int:
    """Read bounded EOCD metadata before ZipFile allocates one ZipInfo per member."""

    eocd_offset = _find_eocd(source)
    (
        disk_number,
        central_directory_disk,
        entries_on_disk,
        entry_count,
        central_directory_size,
        central_directory_offset,
        _comment_length,
    ) = struct.unpack_from("<4H2LH", source, eocd_offset + 4)

    if disk_number or central_directory_disk or entries_on_disk != entry_count:
        raise InvalidPptxError("multi-disk PPTX ZIP packages are not supported")

    if (
        entries_on_disk == 0xFFFF
        or entry_count == 0xFFFF
        or central_directory_size == 0xFFFFFFFF
        or central_directory_offset == 0xFFFFFFFF
    ):
        (
            entry_count,
            central_directory_size,
            central_directory_offset,
        ) = _read_zip64_directory(source, eocd_offset)

    if entry_count > limits.entry_max_count:
        raise PptxLimitExceededError("PPTX ZIP contains too many entries")
    if central_directory_size > limits.central_directory_max_bytes:
        raise PptxLimitExceededError("PPTX ZIP central directory exceeds the size limit")
    if (
        central_directory_offset > len(source)
        or central_directory_size > len(source) - central_directory_offset
        or central_directory_offset + central_directory_size > eocd_offset
    ):
        raise InvalidPptxError("PPTX ZIP central directory bounds are invalid")
    return int(entry_count)


def _find_eocd(source: bytes) -> int:
    if len(source) < _EOCD_MIN_BYTES:
        raise InvalidPptxError("invalid PPTX ZIP package")
    search_start = max(0, len(source) - _EOCD_MAX_SEARCH_BYTES)
    candidate_end = len(source)
    while (offset := source.rfind(_EOCD_SIGNATURE, search_start, candidate_end)) >= 0:
        if offset + _EOCD_MIN_BYTES <= len(source):
            comment_length = struct.unpack_from("<H", source, offset + 20)[0]
            if offset + _EOCD_MIN_BYTES + comment_length == len(source):
                return offset
        candidate_end = offset
    raise InvalidPptxError("invalid PPTX ZIP end-of-central-directory record")


def _read_zip64_directory(source: bytes, eocd_offset: int) -> tuple[int, int, int]:
    locator_offset = eocd_offset - 20
    if (
        locator_offset < 0
        or source[locator_offset : locator_offset + 4] != _ZIP64_LOCATOR_SIGNATURE
    ):
        raise InvalidPptxError("invalid ZIP64 PPTX locator")
    zip64_disk, zip64_offset, disk_count = struct.unpack_from("<LQL", source, locator_offset + 4)
    if zip64_disk != 0 or disk_count != 1:
        raise InvalidPptxError("multi-disk PPTX ZIP packages are not supported")
    if (
        zip64_offset > len(source) - 56
        or source[zip64_offset : zip64_offset + 4] != _ZIP64_EOCD_SIGNATURE
    ):
        raise InvalidPptxError("invalid ZIP64 PPTX directory record")

    record_size = struct.unpack_from("<Q", source, zip64_offset + 4)[0]
    if record_size < 44 or zip64_offset + 12 + record_size > locator_offset:
        raise InvalidPptxError("invalid ZIP64 PPTX directory bounds")
    disk_number, central_directory_disk = struct.unpack_from("<2L", source, zip64_offset + 16)
    entries_on_disk, entry_count, central_directory_size, central_directory_offset = (
        struct.unpack_from("<4Q", source, zip64_offset + 24)
    )
    if disk_number or central_directory_disk or entries_on_disk != entry_count:
        raise InvalidPptxError("multi-disk PPTX ZIP packages are not supported")
    return int(entry_count), int(central_directory_size), int(central_directory_offset)


def _validate_entry(entry: ZipInfo, limits: PptxValidationLimits) -> str:
    if entry.flag_bits & 0x1:
        raise InvalidPptxError("encrypted PPTX ZIP entries are not supported")
    if entry.compress_type not in _SUPPORTED_COMPRESSION:
        raise InvalidPptxError("PPTX ZIP entry uses unsupported compression")

    # On Windows zipfile normalizes backslashes in ``filename``. ``orig_filename``
    # retains the archive spelling needed to reject separator ambiguity.
    raw_name = entry.orig_filename
    is_directory = entry.is_dir()
    candidate = raw_name[:-1] if is_directory else raw_name
    windows_path = PureWindowsPath(raw_name)
    if (
        not candidate
        or "\x00" in raw_name
        or "\\" in raw_name
        or raw_name.startswith("/")
        or windows_path.is_absolute()
        or bool(windows_path.drive)
    ):
        raise InvalidPptxError("PPTX ZIP contains an unsafe entry path")

    segments = candidate.split("/")
    if any(segment in {"", ".", ".."} for segment in segments):
        raise InvalidPptxError("PPTX ZIP contains an unsafe entry path")

    mode = entry.external_attr >> 16
    if stat.S_ISLNK(mode):
        raise InvalidPptxError("PPTX ZIP symbolic-link entries are not supported")
    if entry.file_size > limits.entry_max_uncompressed_bytes:
        raise PptxLimitExceededError("PPTX ZIP entry exceeds the configured size limit")
    if raw_name.casefold().endswith((".xml", ".rels")) and (
        entry.file_size > limits.xml_entry_max_uncompressed_bytes
    ):
        raise PptxLimitExceededError("PPTX XML entry exceeds the configured size limit")
    if entry.file_size and (
        entry.compress_size <= 0
        or entry.file_size / entry.compress_size > limits.compression_ratio_max
    ):
        raise PptxLimitExceededError("PPTX ZIP entry exceeds the compression ratio limit")

    normalized_segments = (unicodedata.normalize("NFC", segment) for segment in segments)
    return "/".join(normalized_segments).casefold()


def _validate_relationships(
    archive: ZipFile,
    entries: list[ZipInfo],
    member_names: set[str],
    limits: PptxValidationLimits,
) -> None:
    relationship_count = 0
    for entry in entries:
        if not entry.filename.casefold().endswith(".rels"):
            continue
        raw_xml = archive.read(entry)
        markup_probe = raw_xml.replace(b"\x00", b"").upper()
        if b"<!DOCTYPE" in markup_probe or b"<!ENTITY" in markup_probe:
            raise InvalidPptxError("PPTX relationships must not contain DTDs or entities")
        try:
            root = ElementTree.fromstring(raw_xml)
        except ElementTree.ParseError as exc:
            raise InvalidPptxError("invalid PPTX relationship XML") from exc
        if root.tag != f"{{{_RELATIONSHIPS_NAMESPACE}}}Relationships":
            raise InvalidPptxError("invalid PPTX relationships root")

        relationship_ids: set[str] = set()
        for relationship in root:
            if relationship.tag != f"{{{_RELATIONSHIPS_NAMESPACE}}}Relationship":
                raise InvalidPptxError("invalid PPTX relationship element")
            relationship_count += 1
            if relationship_count > limits.relationship_max_count:
                raise PptxLimitExceededError("PPTX contains too many relationships")

            relationship_id = relationship.get("Id", "")
            relationship_type = relationship.get("Type", "")
            target = relationship.get("Target", "")
            if (
                not relationship_id
                or relationship_id in relationship_ids
                or not relationship_type
                or not target
            ):
                raise InvalidPptxError("PPTX relationship identity is invalid")
            relationship_ids.add(relationship_id)
            if relationship.get("TargetMode", "").casefold() == "external":
                continue
            resolved_target = _resolve_internal_target(entry.filename, target)
            if unicodedata.normalize("NFC", resolved_target).casefold() not in member_names:
                raise InvalidPptxError("PPTX internal relationship target is missing")


def _resolve_internal_target(relationship_part: str, target: str) -> str:
    try:
        parsed_target = urlsplit(target)
    except (UnicodeError, ValueError) as exc:
        raise InvalidPptxError("PPTX internal relationship target is unsafe") from exc
    if parsed_target.scheme or parsed_target.netloc or parsed_target.query:
        raise InvalidPptxError("PPTX internal relationship target is unsafe")
    decoded_path = unquote(parsed_target.path)
    if not decoded_path or "\x00" in decoded_path or "\\" in decoded_path:
        raise InvalidPptxError("PPTX internal relationship target is unsafe")

    base_segments = _relationship_owner_directory(relationship_part)
    resolved = [] if decoded_path.startswith("/") else list(base_segments)
    for segment in decoded_path.lstrip("/").split("/"):
        segment = unicodedata.normalize("NFC", segment)
        if segment in {"", "."}:
            if segment == "":
                raise InvalidPptxError("PPTX internal relationship target is unsafe")
            continue
        if segment == "..":
            if not resolved:
                raise InvalidPptxError("PPTX internal relationship escapes the package root")
            resolved.pop()
            continue
        resolved.append(segment)
    if not resolved:
        raise InvalidPptxError("PPTX internal relationship target is unsafe")
    return "/".join(resolved)


def _relationship_owner_directory(relationship_part: str) -> tuple[str, ...]:
    if relationship_part == "_rels/.rels":
        return ()
    marker = "/_rels/"
    if marker not in relationship_part or not relationship_part.endswith(".rels"):
        raise InvalidPptxError("PPTX relationship part path is invalid")
    owner_directory, relationship_name = relationship_part.split(marker, maxsplit=1)
    if not relationship_name[:-5]:
        raise InvalidPptxError("PPTX relationship part path is invalid")
    return tuple(owner_directory.split("/"))


def _text_frame_text(text_frame: object) -> str:
    paragraphs = (
        _normalize_text(paragraph.text) for paragraph in getattr(text_frame, "paragraphs", ())
    )
    return "\n".join(text for text in paragraphs if text)


def _table_text(table: object) -> str:
    rows: list[str] = []
    for row in getattr(table, "rows", ()):
        cells = [_normalize_text(cell.text) for cell in row.cells]
        if any(cells):
            rows.append(" | ".join(cells))
    return "\n".join(rows)


def _notes_text(slide: object) -> str:
    if not getattr(slide, "has_notes_slide", False):
        return ""
    try:
        text_frame = slide.notes_slide.notes_text_frame
    except (AttributeError, KeyError):
        return ""
    return _text_frame_text(text_frame) if text_frame is not None else ""


def _normalize_text(value: str) -> str:
    return " ".join(unicodedata.normalize("NFC", value).split())
