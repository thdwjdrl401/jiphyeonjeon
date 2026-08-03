from stt_lab.metrics import evaluate_transcript, normalize_korean_text


def test_normalize_korean_text_removes_punctuation_and_normalizes_width() -> None:
    assert normalize_korean_text("ＬｉｖｅＫｉｔ, 연결!") == "livekit 연결"


def test_metrics_keep_raw_and_normalized_cer_separate() -> None:
    metrics = evaluate_transcript("안녕하세요.", "안녕하세요")

    assert metrics.raw_cer > 0
    assert metrics.normalized_cer == 0
    assert metrics.literal_normalized_cer == 0


def test_metrics_measure_terms_and_number_sequence() -> None:
    metrics = evaluate_transcript(
        "WebRTC는 12개 방을 처리합니다.",
        "webrtc는 10개 방을 처리합니다",
        ("WebRTC", "LiveKit"),
    )

    assert metrics.term_recall == 0.5
    assert metrics.number_exact_match == 0.0


def test_metrics_accept_written_pronounced_and_mixed_aihub_references() -> None:
    reference = "(system)/(시스템)과 (API)/(에이피아이) (0)/(빵)을 확인합니다."

    written = evaluate_transcript(reference, "system과 API 0을 확인합니다")
    pronounced = evaluate_transcript(reference, "시스템과 에이피아이 빵을 확인합니다")
    mixed = evaluate_transcript(reference, "system과 에이피아이 빵을 확인합니다")

    assert written.normalized_cer == 0
    assert pronounced.normalized_cer == 0
    assert mixed.normalized_cer == 0
    assert written.number_exact_match == 1.0
    assert pronounced.number_exact_match == 1.0
    assert mixed.reference_alternative_count == 3
    assert mixed.literal_normalized_cer > 0
    assert mixed.normalized_reference == "system과 api 0을 확인합니다"


def test_metrics_handle_many_reference_alternatives_without_enumeration() -> None:
    reference = " ".join(f"(term{index})/(용어{index})" for index in range(23))
    hypothesis = " ".join(
        f"term{index}" if index % 2 == 0 else f"용어{index}" for index in range(23)
    )

    metrics = evaluate_transcript(reference, hypothesis)

    assert metrics.normalized_cer == 0
    assert metrics.reference_alternative_count == 23
