from __future__ import annotations

import pytest

from app.stt.sentence_boundary import split_sentences


def test_splits_at_terminal_punctuation_and_drops_the_separating_space() -> None:
    assert split_sentences("둘째는 입력 검증입니다. 제목이 비어있지 않은지 확인합니다.") == [
        "둘째는 입력 검증입니다.",
        "제목이 비어있지 않은지 확인합니다.",
    ]


def test_splits_at_question_and_exclamation_marks() -> None:
    assert split_sentences("여기까지 이해되셨나요? 그럼 넘어갑니다! 다음은 예외 처리입니다.") == [
        "여기까지 이해되셨나요?",
        "그럼 넘어갑니다!",
        "다음은 예외 처리입니다.",
    ]


def test_keeps_a_closing_quote_or_bracket_with_its_own_sentence() -> None:
    assert split_sentences('강사가 "여기를 보세요." 라고 했습니다. 다음 장입니다.') == [
        '강사가 "여기를 보세요."',
        "라고 했습니다.",
        "다음 장입니다.",
    ]


def test_a_final_terminal_does_not_produce_an_empty_trailing_piece() -> None:
    assert split_sentences("여기를 보세요.") == ["여기를 보세요."]
    assert split_sentences("여기를 보세요.   ") == ["여기를 보세요."]


def test_text_without_terminal_punctuation_stays_one_piece() -> None:
    assert split_sentences("자막이 문장부호 없이 계속 이어지는 경우입니다") == [
        "자막이 문장부호 없이 계속 이어지는 경우입니다"
    ]


def test_does_not_split_inside_a_decimal_or_version_number() -> None:
    assert split_sentences("정확도는 3.14 정도이고 버전은 1.2.3 입니다") == [
        "정확도는 3.14 정도이고 버전은 1.2.3 입니다"
    ]
    assert split_sentences("정확도는 3.14 입니다. 다음으로 넘어갑니다.") == [
        "정확도는 3.14 입니다.",
        "다음으로 넘어갑니다.",
    ]


def test_does_not_split_at_an_ellipsis_or_a_repeated_terminal() -> None:
    assert split_sentences("그러니까... 이 부분이 핵심입니다.") == [
        "그러니까... 이 부분이 핵심입니다."
    ]
    assert split_sentences("정말요?! 확인해 보겠습니다.") == ["정말요?! 확인해 보겠습니다."]
    assert split_sentences("여기를 보세요… 다음 장입니다.") == ["여기를 보세요… 다음 장입니다."]


def test_does_not_split_when_the_terminal_is_glued_to_the_next_word() -> None:
    assert split_sentences("파일은 worker.py 이고 로그는 app.log 입니다") == [
        "파일은 worker.py 이고 로그는 app.log 입니다"
    ]


def test_a_piece_without_words_is_absorbed_by_its_neighbour() -> None:
    # A stray terminal must never become a caption line of its own.
    assert split_sentences("첫 문장입니다. . 두 번째 문장입니다.") == [
        "첫 문장입니다..",
        "두 번째 문장입니다.",
    ]


def test_blank_text_yields_no_sentences() -> None:
    assert split_sentences("") == []
    assert split_sentences("   ") == []


def test_rejects_a_non_string() -> None:
    with pytest.raises(TypeError):
        split_sentences(None)  # type: ignore[arg-type]
