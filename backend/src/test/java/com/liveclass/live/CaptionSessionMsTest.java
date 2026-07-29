package com.liveclass.live;

import com.liveclass.live.service.CaptionSessionMs;
import org.junit.jupiter.api.Test;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 근사 세션-ms 계산 단위 테스트(ADR-0045). occurredAt−clockOriginAt를 ms로, 앵커/시각 없음은 null,
 * 시계 스큐로 음수면 0 clamp.
 */
class CaptionSessionMsTest {

    private static OffsetDateTime at(int h, int m, int s, int millis) {
        return OffsetDateTime.of(2026, 8, 1, h, m, s, millis * 1_000_000, ZoneOffset.UTC);
    }

    @Test
    void computes_ms_between_clock_origin_and_occurred_at() {
        Long ms = CaptionSessionMs.approximate(at(10, 0, 0, 0), at(10, 0, 41, 500));
        assertThat(ms).isEqualTo(41_500L);
    }

    @Test
    void null_when_clock_origin_is_missing() {
        assertThat(CaptionSessionMs.approximate(null, at(10, 0, 41, 0))).isNull();
    }

    @Test
    void null_when_occurred_at_is_missing() {
        assertThat(CaptionSessionMs.approximate(at(10, 0, 0, 0), null)).isNull();
    }

    @Test
    void clamps_negative_skew_to_zero() {
        // occurredAt이 clockOriginAt보다 앞선다(GPU↔Spring 시계 스큐) → 0으로 clamp.
        assertThat(CaptionSessionMs.approximate(at(10, 0, 5, 0), at(10, 0, 3, 0))).isEqualTo(0L);
    }
}
