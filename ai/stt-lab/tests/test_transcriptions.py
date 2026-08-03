from stt_lab.transcriptions import (
    canonical_transcription,
    parse_aihub_transcription,
    transcription_alternative_count,
)


def test_canonical_transcription_selects_written_or_pronounced_form() -> None:
    value = "(software)/(소프트웨어)와 (0)/(빵)을 확인합니다."

    assert canonical_transcription(value) == "software와 0을 확인합니다."
    assert canonical_transcription(value, pronunciation=True) == "소프트웨어와 빵을 확인합니다."
    assert transcription_alternative_count(value) == 2


def test_parser_keeps_mixed_alternatives_without_enumerating_combinations() -> None:
    segments = parse_aihub_transcription("(system)/(시스템)과 (API)/(에이피아이)")

    assert [segment.alternatives for segment in segments] == [
        (("system", "시스템")),
        (("과 ",)),
        (("API", "에이피아이")),
    ]


def test_parser_repairs_known_aihub_markup_typos() -> None:
    assert canonical_transcription("gpio)/(지피아이오)", pronunciation=True) == "지피아이오"
    assert canonical_transcription("(labview))/(랩뷰)", pronunciation=True) == "랩뷰"
    assert canonical_transcription("(precut)/(프리컷이 잘라", pronunciation=True) == "프리컷이 잘라"
    assert canonical_transcription("(for)/()문", pronunciation=True) == "문"
