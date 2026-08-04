from __future__ import annotations

import io

import pytest
from PIL import Image

from app.domain import AnnotationIngestionError
from app.ingestion import MAX_ANNOTATION_IMAGE_EDGE_PX, downscale_annotation_image


def _png(width: int, height: int, *, mode: str = "RGB") -> bytes:
    buffer = io.BytesIO()
    Image.new(mode, (width, height), color=0 if mode == "P" else (10, 20, 30)).save(
        buffer, format="PNG"
    )
    return buffer.getvalue()


def _size(image: bytes) -> tuple[int, int]:
    with Image.open(io.BytesIO(image)) as opened:
        return opened.size


def test_leaves_an_image_within_budget_byte_for_byte() -> None:
    """Re-encoding a compliant crop would only cost quality and time."""
    original = _png(800, 600)

    assert downscale_annotation_image(original) is original


def test_keeps_an_image_exactly_at_the_edge_budget() -> None:
    original = _png(MAX_ANNOTATION_IMAGE_EDGE_PX, 400)

    assert downscale_annotation_image(original) is original


@pytest.mark.parametrize(
    ("width", "height", "expected"),
    [
        (3_136, 1_568, (1_568, 784)),
        (1_568, 3_136, (784, 1_568)),
        (2_000, 2_000, (1_568, 1_568)),
    ],
)
def test_shrinks_the_long_edge_and_keeps_the_aspect_ratio(
    width: int, height: int, expected: tuple[int, int]
) -> None:
    result = downscale_annotation_image(_png(width, height))

    assert _size(result) == expected


def test_an_extreme_aspect_ratio_never_collapses_to_zero() -> None:
    result = downscale_annotation_image(_png(4_000, 1))

    assert _size(result) == (MAX_ANNOTATION_IMAGE_EDGE_PX, 1)


def test_palette_images_survive_the_resize() -> None:
    result = downscale_annotation_image(_png(2_000, 1_000, mode="P"))

    assert _size(result) == (MAX_ANNOTATION_IMAGE_EDGE_PX, 784)


def test_rejects_an_empty_image() -> None:
    with pytest.raises(AnnotationIngestionError, match="must not be empty"):
        downscale_annotation_image(b"")


def test_rejects_bytes_that_are_not_an_image() -> None:
    with pytest.raises(AnnotationIngestionError, match="could not be decoded"):
        downscale_annotation_image(b"not-a-png-at-all")
