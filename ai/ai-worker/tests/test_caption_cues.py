from app.recorded_stt.caption_cues import CaptionCueAssembler
from app.recorded_stt.openai_whisper import WhisperResult, WhisperSegment, WhisperWord
from app.recorded_stt.transcription_normalizer import normalize_transcription


def _word(start: float, end: float, text: str) -> WhisperWord:
    return WhisperWord(start=start, end=end, word=text)


def test_splits_continuous_speech_at_sentence_boundaries() -> None:
    cues = CaptionCueAssembler().assemble(
        (
            _word(0.1, 0.5, "안녕하세요"),
            _word(0.6, 1.0, "여러분."),
            _word(1.1, 1.5, "오늘은"),
            _word(1.6, 2.2, "자막을"),
            _word(2.3, 3.0, "배웁니다."),
        )
    )

    assert [(cue.start_seconds, cue.end_seconds, cue.text) for cue in cues] == [
        (0.1, 1.0, "안녕하세요 여러분."),
        (1.1, 3.0, "오늘은 자막을 배웁니다."),
    ]


def test_splits_at_a_speech_pause_without_punctuation() -> None:
    cues = CaptionCueAssembler(pause_break_ms=500).assemble(
        (
            _word(0.0, 0.4, "첫"),
            _word(0.5, 1.0, "발화"),
            _word(1.6, 2.0, "다음"),
            _word(2.1, 2.5, "발화"),
        )
    )

    assert [cue.text for cue in cues] == ["첫 발화", "다음 발화"]
    assert cues[1].start_seconds == 1.6


def test_caps_a_continuous_monologue_by_duration_and_character_count() -> None:
    words = tuple(_word(index * 0.8, index * 0.8 + 0.5, "긴단어") for index in range(10))
    cues = CaptionCueAssembler(max_duration_ms=3_000, max_chars=10).assemble(words)

    assert len(cues) > 1
    assert all((cue.end_seconds - cue.start_seconds) <= 3.0 for cue in cues)
    assert all(len(cue.text) <= 10 for cue in cues)


def test_attaches_punctuation_tokens_without_an_extra_space() -> None:
    cues = CaptionCueAssembler().assemble(
        (
            _word(0.0, 0.4, "문장"),
            _word(0.4, 0.5, " ."),
        )
    )

    assert cues[0].text == "문장."


def test_uses_provider_segment_text_as_the_primary_caption() -> None:
    transcription = normalize_transcription(
        WhisperResult(
            duration=5.0,
            text="이 영상은 테스트 영상입니다.",
            segments=(
                WhisperSegment(start=1.0, end=4.0, text=" 이 영상은 테스트 영상입니다. "),
            ),
            words=(
                _word(1.0, 1.4, "이"),
                _word(1.4, 2.0, "영상은"),
                _word(2.0, 2.6, "테스트"),
                _word(2.6, 4.0, "영상입니다"),
            ),
        )
    )

    cues = CaptionCueAssembler().assemble_transcription(transcription)

    assert [(cue.start_seconds, cue.end_seconds, cue.text) for cue in cues] == [
        (1.0, 4.0, "이 영상은 테스트 영상입니다."),
    ]


def test_splits_a_long_segment_with_words_and_preserves_punctuation() -> None:
    transcription = normalize_transcription(
        WhisperResult(
            duration=4.0,
            text="첫 문장입니다. 다음 문장입니다.",
            segments=(
                WhisperSegment(start=0.0, end=3.0, text="첫 문장입니다. 다음 문장입니다."),
            ),
            words=(
                _word(0.0, 0.4, "첫"),
                _word(0.5, 1.0, "문장입니다"),
                _word(1.1, 1.5, "다음"),
                _word(1.6, 3.0, "문장입니다"),
            ),
        )
    )

    cues = CaptionCueAssembler(max_chars=12).assemble_transcription(transcription)

    assert [cue.text for cue in cues] == ["첫 문장입니다.", "다음 문장입니다."]
    assert [(cue.start_seconds, cue.end_seconds) for cue in cues] == [
        (0.0, 1.0),
        (1.1, 3.0),
    ]


def test_keeps_a_long_segment_when_word_alignment_fails() -> None:
    transcription = normalize_transcription(
        WhisperResult(
            duration=8.0,
            text="문장부호를 포함한 긴 자막입니다.",
            segments=(
                WhisperSegment(start=0.0, end=7.0, text="문장부호를 포함한 긴 자막입니다."),
            ),
            words=(_word(0.0, 7.0, "일치하지않음"),),
        )
    )

    cues = CaptionCueAssembler(max_duration_ms=6_000).assemble_transcription(transcription)

    assert [(cue.start_seconds, cue.end_seconds, cue.text) for cue in cues] == [
        (0.0, 7.0, "문장부호를 포함한 긴 자막입니다."),
    ]
