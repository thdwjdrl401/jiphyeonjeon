from __future__ import annotations

import builtins
from dataclasses import replace
from io import BytesIO
import socket
import stat
import struct
import warnings
from zipfile import ZIP_BZIP2, ZIP_DEFLATED, ZipFile, ZipInfo

from pptx import Presentation
from pptx.util import Inches
import pytest

import app.ingestion.pptx_parser as pptx_parser
from app.domain import InvalidPptxError, PptxLimitExceededError
from app.ingestion import PptxValidationLimits, parse_pptx


def test_extracts_text_table_and_notes_in_stable_slide_order() -> None:
    presentation = Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[6])
    _add_text(slide, "  title   text  ", top=0.5)
    table = slide.shapes.add_table(2, 2, Inches(0.5), Inches(1.5), Inches(6), Inches(2)).table
    table.cell(0, 0).text = "A"
    table.cell(0, 1).text = "B"
    table.cell(1, 0).text = "C"
    table.cell(1, 1).text = "D"
    slide.notes_slide.notes_text_frame.text = " speaker   note "
    second_slide = presentation.slides.add_slide(presentation.slide_layouts[6])
    _add_text(second_slide, "second slide", top=0.5)

    source = _save(presentation)
    first = parse_pptx(source)
    second = parse_pptx(source)

    assert first == second
    assert first.page_count == 2
    assert [(block.page, block.order, block.kind, block.text) for block in first.blocks] == [
        (1, 0, "text", "title text"),
        (1, 1, "table", "A | B\nC | D"),
        (1, 2, "notes", "speaker note"),
        (2, 0, "text", "second slide"),
    ]


def test_no_notes_and_external_links_never_touch_filesystem_or_network(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    presentation = Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[6])
    text_box = _add_text(slide, "links", top=0.5)
    paragraph = text_box.text_frame.paragraphs[0]
    web_run = paragraph.add_run()
    web_run.text = " web"
    web_run.hyperlink.address = "https://example.invalid/material"
    file_run = paragraph.add_run()
    file_run.text = " file"
    file_run.hyperlink.address = "file:///tmp/secret"
    source = _save(presentation)

    def forbidden_io(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("PPTX parsing attempted external I/O")

    monkeypatch.setattr(builtins, "open", forbidden_io)
    monkeypatch.setattr(socket.socket, "connect", forbidden_io)

    parsed = parse_pptx(source)

    assert parsed.page_count == 1
    assert parsed.blocks[0].text == "links web file"


def test_parse_is_independent_of_zip_member_order() -> None:
    source = _deck_with_text("repeatable")
    reordered = _rewrite_archive(source, reverse=True)

    assert parse_pptx(reordered) == parse_pptx(source)


def test_malformed_ooxml_is_reported_as_invalid_pptx() -> None:
    source = _replace_member(
        _deck_with_text("text"),
        "ppt/presentation.xml",
        b"<p:presentation",
    )

    with pytest.raises(InvalidPptxError, match="invalid PPTX package"):
        parse_pptx(source)


def test_generic_zip_is_not_accepted_as_pptx() -> None:
    stream = BytesIO()
    with ZipFile(stream, "w", ZIP_DEFLATED) as archive:
        archive.writestr("document.txt", "not a presentation")

    with pytest.raises(InvalidPptxError, match="complete PPTX"):
        parse_pptx(stream.getvalue())


def test_entry_count_is_rejected_before_zipfile_allocates_members(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = _set_eocd_entry_count(_deck_with_text("text"), 10_001)

    def unexpected_zipfile(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("ZipFile must not be constructed above the entry limit")

    monkeypatch.setattr(pptx_parser, "ZipFile", unexpected_zipfile)

    with pytest.raises(PptxLimitExceededError, match="too many entries"):
        parse_pptx(source)


@pytest.mark.parametrize(
    "member_name",
    [
        "../escape.xml",
        "/absolute.xml",
        "//server/share.xml",
        "C:/drive.xml",
        "ppt//double.xml",
        "ppt/./dot.xml",
    ],
)
def test_rejects_unsafe_zip_member_paths(member_name: str) -> None:
    source = _append_member(_deck_with_text("text"), member_name, b"bad")

    with pytest.raises(InvalidPptxError, match="unsafe entry path"):
        parse_pptx(source)


def test_rejects_raw_backslash_zip_member_path() -> None:
    source = _append_member(_deck_with_text("text"), "ppt/backslash.xml", b"bad")
    source = source.replace(b"ppt/backslash.xml", b"ppt\\backslash.xml")

    with pytest.raises(InvalidPptxError, match="unsafe entry path"):
        parse_pptx(source)


def test_rejects_duplicate_or_case_colliding_zip_members() -> None:
    source = _append_member(
        _deck_with_text("text"),
        "PPT/PRESENTATION.XML",
        b"collision",
    )

    with pytest.raises(InvalidPptxError, match="duplicate or non-canonical"):
        parse_pptx(source)


def test_rejects_exact_duplicate_zip_members() -> None:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        source = _append_member(
            _deck_with_text("text"),
            "ppt/presentation.xml",
            b"duplicate",
        )

    with pytest.raises(InvalidPptxError, match="duplicate or non-canonical"):
        parse_pptx(source)


def test_rejects_symbolic_link_zip_members() -> None:
    info = ZipInfo("ppt/symlink.xml")
    info.create_system = 3
    info.external_attr = (stat.S_IFLNK | 0o777) << 16
    info.compress_type = ZIP_DEFLATED
    source = _append_info(_deck_with_text("text"), info, b"target")

    with pytest.raises(InvalidPptxError, match="symbolic-link"):
        parse_pptx(source)


def test_rejects_encrypted_zip_members() -> None:
    member_name = "ppt/encrypted.bin"
    source = _append_member(_deck_with_text("text"), member_name, b"secret")
    source = _set_encrypted_flag(source, member_name)

    with pytest.raises(InvalidPptxError, match="encrypted"):
        parse_pptx(source)


def test_rejects_unsupported_zip_compression() -> None:
    source = _append_member(
        _deck_with_text("text"),
        "ppt/nonstandard.bin",
        b"content",
        compression=ZIP_BZIP2,
    )

    with pytest.raises(InvalidPptxError, match="unsupported compression"):
        parse_pptx(source)


def test_rejects_high_ratio_zip_bomb_before_presentation_parse() -> None:
    source = _append_member(
        _deck_with_text("text"),
        "ppt/repeated.bin",
        b"A" * 200_000,
    )
    limits = replace(PptxValidationLimits(), compression_ratio_max=10)

    with pytest.raises(PptxLimitExceededError, match="compression ratio"):
        parse_pptx(source, limits=limits)


@pytest.mark.parametrize(
    ("limit_name", "limit_value", "message"),
    [
        ("source_max_bytes", 1, "source"),
        ("central_directory_max_bytes", 1, "central directory"),
        ("uncompressed_max_bytes", 1, "uncompressed"),
        ("entry_max_count", 1, "entries"),
        ("entry_max_uncompressed_bytes", 1, "entry"),
        ("xml_entry_max_uncompressed_bytes", 1, "XML entry"),
        ("relationship_max_count", 1, "relationships"),
    ],
)
def test_rejects_package_resource_limit_overflow(
    limit_name: str,
    limit_value: int,
    message: str,
) -> None:
    source = _deck_with_text("text")
    limits = replace(PptxValidationLimits(), **{limit_name: limit_value})

    with pytest.raises(PptxLimitExceededError, match=message):
        parse_pptx(source, limits=limits)


def test_rejects_slide_block_and_text_limit_overflow() -> None:
    presentation = Presentation()
    first_slide = presentation.slides.add_slide(presentation.slide_layouts[6])
    _add_text(first_slide, "first block", top=0.5)
    _add_text(first_slide, "second block", top=1.5)
    second_slide = presentation.slides.add_slide(presentation.slide_layouts[6])
    _add_text(second_slide, "third block", top=0.5)
    source = _save(presentation)

    with pytest.raises(PptxLimitExceededError, match="slides"):
        parse_pptx(source, limits=replace(PptxValidationLimits(), slide_max_count=1))
    with pytest.raises(PptxLimitExceededError, match="shapes"):
        parse_pptx(source, limits=replace(PptxValidationLimits(), shape_max_count=1))
    with pytest.raises(PptxLimitExceededError, match="text blocks"):
        parse_pptx(source, limits=replace(PptxValidationLimits(), block_max_count=1))
    with pytest.raises(PptxLimitExceededError, match="indexable text"):
        parse_pptx(source, limits=replace(PptxValidationLimits(), text_max_chars=1))


def test_rejects_relationship_dtd_and_package_root_escape() -> None:
    source = _deck_with_text("text")
    dtd_relationships = b"""<?xml version='1.0'?>
<!DOCTYPE Relationships [<!ENTITY x 'boom'>]>
<Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'>
  <Relationship Id='rId1' Type='x' Target='ppt/presentation.xml'/>
</Relationships>"""
    with pytest.raises(InvalidPptxError, match="DTDs or entities"):
        parse_pptx(_replace_member(source, "_rels/.rels", dtd_relationships))

    escaping_relationships = b"""<?xml version='1.0'?>
<Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'>
  <Relationship Id='rId1' Type='x' Target='../outside.xml'/>
</Relationships>"""
    with pytest.raises(InvalidPptxError, match="escapes the package root"):
        parse_pptx(_replace_member(source, "_rels/.rels", escaping_relationships))

    missing_relationships = b"""<?xml version='1.0'?>
<Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'>
  <Relationship Id='rId1' Type='x' Target='missing.xml'/>
</Relationships>"""
    with pytest.raises(InvalidPptxError, match="target is missing"):
        parse_pptx(_replace_member(source, "_rels/.rels", missing_relationships))

    malformed_target_relationships = b"""<?xml version='1.0'?>
<Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'>
  <Relationship Id='rId1' Type='x' Target='http://['/>
</Relationships>"""
    with pytest.raises(InvalidPptxError, match="target is unsafe"):
        parse_pptx(_replace_member(source, "_rels/.rels", malformed_target_relationships))


def _deck_with_text(text: str) -> bytes:
    presentation = Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[6])
    _add_text(slide, text, top=0.5)
    return _save(presentation)


def _add_text(slide: object, text: str, *, top: float) -> object:
    shape = slide.shapes.add_textbox(Inches(0.5), Inches(top), Inches(6), Inches(0.75))
    shape.text = text
    return shape


def _save(presentation: Presentation) -> bytes:
    stream = BytesIO()
    presentation.save(stream)
    return stream.getvalue()


def _rewrite_archive(source: bytes, *, reverse: bool = False) -> bytes:
    with ZipFile(BytesIO(source)) as archive:
        members = [(entry.filename, archive.read(entry)) for entry in archive.infolist()]
    if reverse:
        members.reverse()
    stream = BytesIO()
    with ZipFile(stream, "w", ZIP_DEFLATED) as archive:
        for name, content in members:
            archive.writestr(name, content)
    return stream.getvalue()


def _replace_member(source: bytes, member_name: str, content: bytes) -> bytes:
    with ZipFile(BytesIO(source)) as archive:
        members = [
            (entry.filename, content if entry.filename == member_name else archive.read(entry))
            for entry in archive.infolist()
        ]
    stream = BytesIO()
    with ZipFile(stream, "w", ZIP_DEFLATED) as archive:
        for name, member_content in members:
            archive.writestr(name, member_content)
    return stream.getvalue()


def _append_member(
    source: bytes,
    member_name: str,
    content: bytes,
    *,
    compression: int = ZIP_DEFLATED,
) -> bytes:
    stream = BytesIO(source)
    with ZipFile(stream, "a", compression) as archive:
        archive.writestr(member_name, content, compress_type=compression)
    return stream.getvalue()


def _append_info(source: bytes, info: ZipInfo, content: bytes) -> bytes:
    stream = BytesIO(source)
    with ZipFile(stream, "a") as archive:
        archive.writestr(info, content)
    return stream.getvalue()


def _set_encrypted_flag(source: bytes, member_name: str) -> bytes:
    mutable = bytearray(source)
    encoded_name = member_name.encode()
    _set_header_flag(
        mutable, b"PK\x03\x04", encoded_name, name_length_offset=26, name_offset=30, flag_offset=6
    )
    _set_header_flag(
        mutable, b"PK\x01\x02", encoded_name, name_length_offset=28, name_offset=46, flag_offset=8
    )
    return bytes(mutable)


def _set_eocd_entry_count(source: bytes, entry_count: int) -> bytes:
    mutable = bytearray(source)
    eocd_offset = mutable.rfind(b"PK\x05\x06")
    if eocd_offset < 0:
        raise AssertionError("EOCD record not found")
    struct.pack_into("<H", mutable, eocd_offset + 8, entry_count)
    struct.pack_into("<H", mutable, eocd_offset + 10, entry_count)
    return bytes(mutable)


def _set_header_flag(
    source: bytearray,
    signature: bytes,
    member_name: bytes,
    *,
    name_length_offset: int,
    name_offset: int,
    flag_offset: int,
) -> None:
    cursor = 0
    while (header := source.find(signature, cursor)) >= 0:
        name_length = struct.unpack_from("<H", source, header + name_length_offset)[0]
        name_start = header + name_offset
        if bytes(source[name_start : name_start + name_length]) == member_name:
            flags = struct.unpack_from("<H", source, header + flag_offset)[0]
            struct.pack_into("<H", source, header + flag_offset, flags | 0x1)
            return
        cursor = name_start + name_length
    raise AssertionError(f"ZIP header not found for {member_name!r}")
