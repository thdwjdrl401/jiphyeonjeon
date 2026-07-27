from app.ingestion import (
    ContentBlock,
    ParsedPresentation,
    chunk_presentation,
    chunk_strategy,
)


def test_chunks_are_page_ordered_contiguous_and_never_cross_slides() -> None:
    presentation = ParsedPresentation(
        page_count=2,
        blocks=(
            ContentBlock(page=2, order=0, kind="text", text="second slide"),
            ContentBlock(page=1, order=1, kind="notes", text="speaker note"),
            ContentBlock(page=1, order=0, kind="text", text="page one"),
        ),
    )

    chunks = chunk_presentation(presentation)

    assert [(chunk.chunk_index, chunk.page, chunk.text) for chunk in chunks] == [
        (0, 1, "page one\nspeaker note"),
        (1, 2, "second slide"),
    ]


def test_chunk_normalization_and_hash_are_stable() -> None:
    presentation = ParsedPresentation(
        page_count=1,
        blocks=(
            ContentBlock(page=1, order=0, kind="text", text="page  one"),
            ContentBlock(page=1, order=1, kind="notes", text="speaker\t note"),
        ),
    )

    first = chunk_presentation(presentation)
    second = chunk_presentation(presentation)

    assert first == second
    assert first[0].text == "page one\nspeaker note"
    assert first[0].content_hash == (
        "c87838d93e9b69b575820c791dc0b6d679138bb6308c70d9e294f10fc2b32c5a"
    )


def test_chunk_text_is_normalized_to_unicode_nfc() -> None:
    presentation = ParsedPresentation(
        page_count=1,
        blocks=(ContentBlock(page=1, order=0, kind="text", text="Cafe\u0301  value"),),
    )

    assert chunk_presentation(presentation)[0].text == "Café value"


def test_long_text_prefers_spaces_and_never_exceeds_limit() -> None:
    text = "alpha beta gamma delta epsilon"
    presentation = ParsedPresentation(
        page_count=1,
        blocks=(ContentBlock(page=1, order=0, kind="text", text=text),),
    )

    chunks = chunk_presentation(presentation, max_chars=10)

    assert all(len(chunk.text) <= 10 for chunk in chunks)
    assert " ".join(chunk.text for chunk in chunks) == text


def test_large_single_token_is_hard_split_without_losing_characters() -> None:
    text = "x" * 250_001
    presentation = ParsedPresentation(
        page_count=1,
        blocks=(ContentBlock(page=1, order=0, kind="text", text=text),),
    )

    chunks = chunk_presentation(presentation, max_chars=1_024)

    assert all(len(chunk.text) <= 1_024 for chunk in chunks)
    assert "".join(chunk.text for chunk in chunks) == text


def test_same_text_on_different_pages_has_different_identity() -> None:
    presentation = ParsedPresentation(
        page_count=2,
        blocks=(
            ContentBlock(page=1, order=0, kind="text", text="same"),
            ContentBlock(page=2, order=0, kind="text", text="same"),
        ),
    )

    chunks = chunk_presentation(presentation)

    assert chunks[0].content_hash != chunks[1].content_hash


def test_chunk_strategy_is_versioned_and_validates_limit() -> None:
    assert chunk_strategy() == "slide-max-1200-v1"
    assert chunk_strategy(500) == "slide-max-500-v1"

    try:
        chunk_strategy(0)
    except ValueError as exc:
        assert "positive" in str(exc)
    else:
        raise AssertionError("zero max_chars must be rejected")
