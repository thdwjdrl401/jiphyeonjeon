from app.captions.text_normalizer import CaptionTextNormalizer


def test_removes_unicode_dashes_and_laughter_jamo() -> None:
    normalizer = CaptionTextNormalizer()

    assert normalizer.normalize_final("- AI‐기반‑강의–자료—설명―끝－ㅋㅋㅎㅎ") == (
        "AI 기반 강의 자료 설명 끝"
    )


def test_preserves_word_boundary_across_delta_fragments() -> None:
    normalizer = CaptionTextNormalizer()

    assert normalizer.normalize_delta("AI-") == "AI"
    assert normalizer.normalize_delta("ㅋㅋbased") == " based"
    assert normalizer.current_text == "AI based"


def test_removes_bracketed_laughter_marker() -> None:
    normalizer = CaptionTextNormalizer()

    assert normalizer.normalize_final("설명 (웃음) 다음 [웃음]") == "설명 다음"


def test_reset_starts_a_new_segment_without_pending_space() -> None:
    normalizer = CaptionTextNormalizer()
    assert normalizer.normalize_delta("첫 문장-") == "첫 문장"

    normalizer.reset_segment()

    assert normalizer.normalize_delta("다음 문장") == "다음 문장"
