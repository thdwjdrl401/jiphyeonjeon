from stt_lab.metrics import evaluate_transcript, normalize_korean_text


def test_normalize_korean_text_removes_punctuation_and_normalizes_width() -> None:
    assert normalize_korean_text("ＬｉｖｅＫｉｔ, 연결!") == "livekit 연결"


def test_metrics_keep_raw_and_normalized_cer_separate() -> None:
    metrics = evaluate_transcript("안녕하세요.", "안녕하세요")

    assert metrics.raw_cer > 0
    assert metrics.normalized_cer == 0


def test_metrics_measure_terms_and_number_sequence() -> None:
    metrics = evaluate_transcript(
        "WebRTC는 12개 방을 처리합니다.",
        "webrtc는 10개 방을 처리합니다",
        ("WebRTC", "LiveKit"),
    )

    assert metrics.term_recall == 0.5
    assert metrics.number_exact_match == 0.0
