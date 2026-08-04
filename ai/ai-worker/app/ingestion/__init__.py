from app.ingestion.annotation_image import (
    MAX_ANNOTATION_IMAGE_EDGE_PX,
    downscale_annotation_image,
)
from app.ingestion.chunker import (
    CHUNK_STRATEGY_VERSION,
    DEFAULT_CHUNK_MAX_CHARS,
    chunk_presentation,
    chunk_strategy,
)
from app.ingestion.models import (
    ContentBlock,
    KeyTerm,
    KeyTermExtractionResult,
    KeyTermResultStatus,
    MaterialChunk,
    ParsedPresentation,
)
from app.ingestion.pptx_parser import PptxValidationLimits, parse_pptx

__all__ = [
    "CHUNK_STRATEGY_VERSION",
    "DEFAULT_CHUNK_MAX_CHARS",
    "MAX_ANNOTATION_IMAGE_EDGE_PX",
    "ContentBlock",
    "KeyTerm",
    "KeyTermExtractionResult",
    "KeyTermResultStatus",
    "MaterialChunk",
    "ParsedPresentation",
    "PptxValidationLimits",
    "chunk_presentation",
    "chunk_strategy",
    "downscale_annotation_image",
    "parse_pptx",
]
