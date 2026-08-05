import pytest

from app.recorded_stt.openai_whisper import (
    WhisperResult,
    WhisperSegment,
    WhisperTranscriptionError,
    WhisperWord,
)
from app.recorded_stt.transcription_normalizer import normalize_transcription


def test_merges_reproduced_zero_duration_word_into_the_next_word() -> None:
    normalized = normalize_transcription(
        WhisperResult(
            duration=13.649999618530273,
            text="안녕하세요. 이 영상은 테스트 영상입니다.",
            segments=(
                WhisperSegment(start=0.0, end=2.02, text="안녕하세요."),
                WhisperSegment(start=2.96, end=4.86, text="이 영상은 테스트 영상입니다."),
            ),
            words=(
                WhisperWord(start=0.0, end=2.02, word="안녕하세요"),
                WhisperWord(start=2.96, end=2.96, word="이"),
                WhisperWord(start=2.96, end=3.6, word="영상은"),
                WhisperWord(start=3.6, end=3.86, word="테스트"),
                WhisperWord(start=3.86, end=4.86, word="영상입니다"),
            ),
        )
    )

    assert [word.word for word in normalized.words] == [
        "안녕하세요",
        "이 영상은",
        "테스트",
        "영상입니다",
    ]
    assert normalized.words[1].start == 2.96
    assert normalized.words[1].end == 3.6
    assert normalized.stats.zero_duration_word_count == 1
    assert normalized.stats.merged_word_count == 1
    assert normalized.stats.fallback_mode == "SEGMENT_PRIMARY"


def test_uses_valid_segments_when_a_word_timestamp_is_invalid() -> None:
    normalized = normalize_transcription(
        WhisperResult(
            duration=4.0,
            text="정상 문장입니다.",
            segments=(WhisperSegment(start=0.0, end=3.0, text="정상 문장입니다."),),
            words=(WhisperWord(start=2.0, end=1.0, word="역전"),),
        )
    )

    assert normalized.segments[0].text == "정상 문장입니다."
    assert normalized.words == ()
    assert normalized.stats.discarded_word_count == 1
    assert normalized.stats.fallback_mode == "SEGMENT_PRIMARY"


def test_falls_back_to_words_when_segments_are_missing() -> None:
    normalized = normalize_transcription(
        WhisperResult(
            duration=2.0,
            text="단어 자막",
            words=(
                WhisperWord(start=0.0, end=0.5, word="단어"),
                WhisperWord(start=0.6, end=1.2, word="자막"),
            ),
        )
    )

    assert normalized.segments == ()
    assert len(normalized.words) == 2
    assert normalized.stats.fallback_mode == "WORD_ONLY"


def test_treats_empty_transcription_as_normal_empty_audio() -> None:
    normalized = normalize_transcription(WhisperResult(duration=2.0))

    assert normalized.segments == ()
    assert normalized.words == ()
    assert normalized.stats.fallback_mode == "EMPTY"


def test_rejects_transcript_without_any_usable_timestamps() -> None:
    with pytest.raises(WhisperTranscriptionError) as captured:
        normalize_transcription(WhisperResult(duration=2.0, text="시간 없는 전사문"))

    assert captured.value.code == "STT_RESPONSE_INVALID"
    assert captured.value.reason == "TIMESTAMPS_MISSING"
    assert captured.value.retryable is False


def test_rejects_nonempty_but_entirely_invalid_timestamp_arrays() -> None:
    with pytest.raises(WhisperTranscriptionError) as captured:
        normalize_transcription(
            WhisperResult(
                duration=2.0,
                segments=(WhisperSegment(start=1.0, end=0.5, text="손상"),),
                words=(WhisperWord(start=1.0, end=0.5, word="손상"),),
            )
        )

    assert captured.value.code == "STT_RESPONSE_INVALID"
    assert captured.value.reason == "TIMESTAMPS_INVALID"
    assert captured.value.retryable is False
