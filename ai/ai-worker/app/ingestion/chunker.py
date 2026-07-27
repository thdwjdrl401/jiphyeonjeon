from __future__ import annotations

from collections import defaultdict
from hashlib import sha256
import unicodedata

from app.ingestion.models import MaterialChunk, ParsedPresentation


DEFAULT_CHUNK_MAX_CHARS = 1_200
CHUNK_STRATEGY_VERSION = "v1"


def chunk_strategy(max_chars: int = DEFAULT_CHUNK_MAX_CHARS) -> str:
    if max_chars <= 0:
        raise ValueError("max_chars must be positive")
    return f"slide-max-{max_chars}-{CHUNK_STRATEGY_VERSION}"


def chunk_presentation(
    presentation: ParsedPresentation,
    *,
    max_chars: int = DEFAULT_CHUNK_MAX_CHARS,
) -> tuple[MaterialChunk, ...]:
    """Build deterministic chunks without joining content from different slides."""

    chunk_strategy(max_chars)
    page_blocks: dict[int, list[str]] = defaultdict(list)
    for block in sorted(presentation.blocks, key=lambda item: (item.page, item.order)):
        text = _normalize_text(block.text)
        if text:
            page_blocks[block.page].append(text)

    chunks: list[MaterialChunk] = []
    for page in sorted(page_blocks):
        for text in _split_page(page_blocks[page], max_chars):
            chunks.append(
                MaterialChunk(
                    chunk_index=len(chunks),
                    page=page,
                    text=text,
                    content_hash=_content_hash(page, text),
                )
            )
    return tuple(chunks)


def _split_page(blocks: list[str], max_chars: int) -> list[str]:
    chunks: list[str] = []
    current = ""
    for block in blocks:
        for piece in _split_long_text(block, max_chars):
            candidate = f"{current}\n{piece}" if current else piece
            if current and len(candidate) > max_chars:
                chunks.append(current)
                current = piece
            else:
                current = candidate
    if current:
        chunks.append(current)
    return chunks


def _split_long_text(text: str, max_chars: int) -> list[str]:
    if len(text) <= max_chars:
        return [text]

    pieces: list[str] = []
    start = 0
    text_length = len(text)
    while text_length - start > max_chars:
        window_end = start + max_chars
        split_at = text.rfind(" ", start, window_end + 1)
        end = window_end if split_at <= start else split_at
        pieces.append(text[start:end].rstrip())
        start = end
        while start < text_length and text[start].isspace():
            start += 1
    if start < text_length:
        pieces.append(text[start:])
    return pieces


def _content_hash(page: int, text: str) -> str:
    return sha256(f"page={page}\n{text}".encode()).hexdigest()


def _normalize_text(value: str) -> str:
    normalized = unicodedata.normalize("NFC", value)
    return "\n".join(" ".join(line.split()) for line in normalized.splitlines() if line.split())
