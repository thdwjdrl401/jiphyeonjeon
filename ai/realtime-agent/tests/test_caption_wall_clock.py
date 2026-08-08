"""자막 시각축 회귀 테스트.

왜 이 파일이 있나
    `stream_elapsed_ms`는 **받은 오디오의 누적 길이**다(경과 시간이 아니다). 무음 억제·뮤트·유실로
    프레임이 오지 않은 구간은 들어가지 않는다. 그래서 `audio_started_at + stream_elapsed_ms`로
    발화 시각을 구하면 **없던 소리만큼 앞당겨진다.**

    이 성질은 코드를 읽어서는 놓치기 쉽고, 실제로 놓쳐서 운영 자막이 세션마다 0.6~21초씩 어긋났다
    (ADR-0106). 그래서 문서가 아니라 **실행되는 테스트**로 못박는다.
"""
from datetime import UTC, datetime, timedelta

from app.audio.segmentation import VadSegmenter
from app.stt.engine import AudioChunk

SAMPLE_RATE = 16_000
FRAME_MS = 20
FRAME_BYTES = SAMPLE_RATE * FRAME_MS // 1_000 * 2


class _AlwaysSpeech:
    """모든 프레임을 발화로 본다 — 여기서 보려는 것은 VAD 판정이 아니라 시각축이다."""

    def is_speech(self, frame: bytes, sample_rate: int) -> bool:
        return True


class _Feeder:
    """벽시계를 우리가 굴린다. 프레임이 오지 않는 동안에도 시간은 흐른다."""

    def __init__(self, segmenter: VadSegmenter) -> None:
        self.segmenter = segmenter
        self.wall = datetime(2026, 8, 9, tzinfo=UTC)
        self.started_at = self.wall
        self.captured_ms = 0

    def speak(self, seconds: float, *, silent_gap: float = 0.0) -> list:
        self.wall += timedelta(seconds=silent_gap)   # 프레임 없이 흐른 시간
        produced = []
        for _ in range(int(seconds * 1_000 / FRAME_MS)):
            self.wall += timedelta(milliseconds=FRAME_MS)
            self.captured_ms += FRAME_MS
            produced.extend(self.segmenter.push(AudioChunk(
                pcm=b"\x01\x00" * (FRAME_BYTES // 2),
                sample_rate=SAMPLE_RATE,
                num_channels=1,
                stream_elapsed_ms=self.captured_ms,
                audio_started_at=self.started_at,
                captured_at=self.wall,
            )))
        return produced

    def ms_since_start(self, moment: datetime) -> int:
        return int((moment - self.started_at) / timedelta(milliseconds=1))


def _segmenter() -> VadSegmenter:
    return VadSegmenter(
        sample_rate=SAMPLE_RATE, frame_ms=FRAME_MS, vad=_AlwaysSpeech(),
        min_speech_ms=100, max_speech_ms=1_000, silence_close_ms=100,
    )


def test_audio_clock_loses_the_silence_that_the_wall_clock_keeps() -> None:
    """오디오 축이 무음을 잃는다는 사실 자체를 고정한다 — 이 전제가 깨지면 아래 테스트도 뜻이 없다."""
    feeder = _Feeder(_segmenter())
    feeder.speak(1.0)
    feeder.speak(1.0, silent_gap=20.0)

    assert feeder.captured_ms == 2_000                      # 받은 소리는 2초뿐
    assert feeder.ms_since_start(feeder.wall) == 22_000     # 그러나 22초가 흘렀다


def test_segment_after_a_gap_carries_the_real_wall_clock() -> None:
    """공백 뒤 발화의 `started_at`이 실제 시각을 가리킨다.

    종전 공식(`audio_started_at + start_ms`)은 같은 발화를 20초 앞으로 당긴다.
    """
    feeder = _Feeder(_segmenter())
    feeder.speak(1.0)
    segments = feeder.speak(1.0, silent_gap=20.0)
    segments += feeder.segmenter.finish()

    after_gap = segments[-1]
    assert after_gap.started_at is not None

    # 진실: 둘째 발화는 1초(첫 발화) + 20초(공백) 지점에서 시작했다.
    assert abs(feeder.ms_since_start(after_gap.started_at) - 21_000) <= FRAME_MS
    # 종전 공식이었다면 1초 지점이라고 답했을 것이다 — 20초 어긋난다.
    assert after_gap.start_ms == 1_000


def test_no_stamp_without_captured_at() -> None:
    """시각을 안 실어 주면 지어내지 않는다 — 종전 동작 그대로다."""
    segmenter = _segmenter()
    captured_ms = 0
    produced = []
    for _ in range(60):
        captured_ms += FRAME_MS
        produced.extend(segmenter.push(AudioChunk(
            pcm=b"\x01\x00" * (FRAME_BYTES // 2),
            sample_rate=SAMPLE_RATE, num_channels=1,
            stream_elapsed_ms=captured_ms,
        )))
    produced += segmenter.finish()

    assert produced
    assert all(segment.started_at is None and segment.ended_at is None for segment in produced)
