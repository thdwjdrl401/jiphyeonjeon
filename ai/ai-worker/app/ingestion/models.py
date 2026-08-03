from dataclasses import dataclass
from typing import Literal


BlockKind = Literal["text", "table", "notes"]


@dataclass(frozen=True, slots=True)
class ContentBlock:
    page: int
    order: int
    kind: BlockKind
    text: str

    def __post_init__(self) -> None:
        if self.page < 1:
            raise ValueError("content block page must be positive")
        if self.order < 0:
            raise ValueError("content block order must be non-negative")
        if self.kind not in {"text", "table", "notes"}:
            raise ValueError("unsupported content block kind")
        if not self.text or not self.text.strip():
            raise ValueError("content block text must not be empty")


@dataclass(frozen=True, slots=True)
class ParsedPresentation:
    page_count: int
    blocks: tuple[ContentBlock, ...]

    def __post_init__(self) -> None:
        if self.page_count < 0:
            raise ValueError("page_count must be non-negative")
        positions: set[tuple[int, int]] = set()
        for block in self.blocks:
            if block.page > self.page_count:
                raise ValueError("content block page exceeds page_count")
            position = (block.page, block.order)
            if position in positions:
                raise ValueError("content block positions must be unique")
            positions.add(position)


@dataclass(frozen=True, slots=True)
class KeyTerm:
    term: str
    definition: str

    def __post_init__(self) -> None:
        if not self.term or not self.term.strip():
            raise ValueError("term must not be empty")
        if not self.definition or not self.definition.strip():
            raise ValueError("definition must not be empty")


KeyTermResultStatus = Literal[
    "NOT_REQUESTED",
    "PENDING",
    "READY",
    "EMPTY",
    "FAILED",
]


@dataclass(frozen=True, slots=True)
class KeyTermExtractionResult:
    """Durable result of the optional PPTX key-term branch (ADR-0010)."""

    status: KeyTermResultStatus
    terms: tuple[KeyTerm, ...] = ()
    failure_code: str | None = None
    truncated: bool = False

    def __post_init__(self) -> None:
        if self.status == "READY" and not self.terms:
            raise ValueError("READY key-term result must contain at least one term")
        if self.status != "READY" and self.terms:
            raise ValueError("only READY key-term result may contain terms")
        if self.status == "FAILED" and not self.failure_code:
            raise ValueError("FAILED key-term result requires failure_code")
        if self.status != "FAILED" and self.failure_code is not None:
            raise ValueError("only FAILED key-term result may contain failure_code")

    @property
    def count(self) -> int:
        return len(self.terms)


@dataclass(frozen=True, slots=True)
class MaterialChunk:
    chunk_index: int
    page: int
    text: str
    content_hash: str

    def __post_init__(self) -> None:
        if self.chunk_index < 0:
            raise ValueError("chunk_index must be non-negative")
        if self.page < 1:
            raise ValueError("chunk page must be positive")
        if not self.text or not self.text.strip():
            raise ValueError("chunk text must not be empty")
        if len(self.content_hash) != 64 or any(
            character not in "0123456789abcdef" for character in self.content_hash
        ):
            raise ValueError("content_hash must be a SHA-256 hexadecimal digest")
