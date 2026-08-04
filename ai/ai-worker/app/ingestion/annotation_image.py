from __future__ import annotations

import io
import logging

from PIL import Image, UnidentifiedImageError

from app.domain import AnnotationIngestionError

logger = logging.getLogger(__name__)

# Vision models bill by tile, and a crop wider than this buys no extra legible detail
# (ADR-0043 §7). Oversized crops are shrunk rather than rejected: the instructor already
# confirmed the highlight, so refusing it would lose evidence over a cost concern.
MAX_ANNOTATION_IMAGE_EDGE_PX = 1_568

# Guards decompression bombs: Pillow allocates on open, before we ever look at the size.
MAX_ANNOTATION_IMAGE_PIXELS = 50_000_000


def downscale_annotation_image(image: bytes) -> bytes:
    """Shrink an oversized PNG crop to the long-edge budget, preserving aspect ratio.

    **Parked alongside `GmsAnnotationReader`** — the worker no longer receives highlight
    images (ADR-0074), so nothing calls this today. See that adapter's docstring for why it
    is kept and what re-wiring needs.

    Returns the original bytes untouched when it already fits — re-encoding a compliant image
    would only cost quality and time.
    """

    if not image:
        raise AnnotationIngestionError("annotation image must not be empty")

    try:
        with Image.open(io.BytesIO(image)) as opened:
            width, height = opened.size
            if max(width, height) <= MAX_ANNOTATION_IMAGE_EDGE_PX:
                return image
            if width * height > MAX_ANNOTATION_IMAGE_PIXELS:
                raise AnnotationIngestionError("annotation image exceeds the pixel limit")

            scale = MAX_ANNOTATION_IMAGE_EDGE_PX / max(width, height)
            target = (max(1, round(width * scale)), max(1, round(height * scale)))
            resized = opened.convert("RGBA") if opened.mode == "P" else opened.copy()
            resized = resized.resize(target, Image.Resampling.LANCZOS)
            buffer = io.BytesIO()
            resized.save(buffer, format="PNG", optimize=True)
    except AnnotationIngestionError:
        raise
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise AnnotationIngestionError("annotation image could not be decoded") from exc

    logger.info(
        "downscaled annotation image",
        extra={
            "event": "annotation.image_downscaled",
            "source_size": f"{width}x{height}",
            "target_size": f"{target[0]}x{target[1]}",
        },
    )
    return buffer.getvalue()
