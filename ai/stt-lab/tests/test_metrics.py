from stt_lab.metrics import (
    evaluate_transcript,
    normalize_korean_text,
    orthographic_training_reference,
)


def test_normalize_korean_text_removes_punctuation_and_normalizes_width() -> None:
    assert normalize_korean_text("ＬｉｖｅＫｉｔ, 연결!") == "livekit 연결"


def test_metrics_keep_raw_and_normalized_cer_separate() -> None:
    metrics = evaluate_transcript("안녕하세요.", "안녕하세요")

    assert metrics.raw_cer > 0
    assert metrics.normalized_cer == 0


def test_dual_transcription_accepts_spelling_pronunciation_and_mixed_forms() -> None:
    reference = "(system)/(시스템)과 (api)/(에이피아이)를 연결합니다."
    training_reference = "system과 api를 연결합니다."

    spelling = evaluate_transcript(
        reference,
        "system과 api를 연결합니다",
        training_reference=training_reference,
    )
    pronunciation = evaluate_transcript(
        reference,
        "시스템과 에이피아이를 연결합니다",
        training_reference=training_reference,
    )
    mixed = evaluate_transcript(
        reference,
        "system과 에이피아이를 연결합니다",
        training_reference=training_reference,
    )

    assert spelling.normalized_cer == 0
    assert pronunciation.normalized_cer == 0
    assert mixed.normalized_cer == 0
    assert spelling.literal_normalized_cer > 0
    assert pronunciation.literal_normalized_cer > 0
    assert mixed.literal_normalized_cer > 0


def test_training_reference_selects_spelling_and_repairs_known_extra_parenthesis() -> None:
    assert (
        orthographic_training_reference("예 (labview))/(랩뷰)와 (software)/(소프트웨어)를 씁니다.")
        == "예 labview와 software를 씁니다."
    )


def test_training_reference_repairs_missing_open_parenthesis() -> None:
    reference = "gpio)/(지피아이오)와 (pull up)/(풀업)을 연결합니다."

    assert orthographic_training_reference(reference) == "gpio와 pull up을 연결합니다."
    assert evaluate_transcript(reference, "지피아이오와 pull up을 연결합니다").normalized_cer == 0


def test_dual_transcription_still_penalizes_unaccepted_text() -> None:
    metrics = evaluate_transcript("(software)/(소프트웨어)를 씁니다.", "하드웨어를 씁니다.")

    assert metrics.normalized_cer > 0


def test_metrics_measure_terms_and_number_sequence() -> None:
    metrics = evaluate_transcript(
        "WebRTC는 12개 방을 처리합니다.",
        "webrtc는 10개 방을 처리합니다",
        ("WebRTC", "LiveKit"),
    )

    assert metrics.term_recall == 0.5
    assert metrics.number_exact_match == 0.0
