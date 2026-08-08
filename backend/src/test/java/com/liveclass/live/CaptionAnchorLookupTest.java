package com.liveclass.live;

import com.liveclass.live.domain.LiveCaption;
import com.liveclass.live.repository.LiveCaptionRepository;
import com.liveclass.live.service.CaptionAnchorLookup;
import com.liveclass.live.service.CaptionEvent;
import com.liveclass.live.service.SessionClockLookup;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 앵커 기반 정확 세션-ms 단위 테스트(ADR-0052 앵커, ADR-0053 후속).
 *
 * <p>핵심은 <b>근사와 다른 값이 나오는지</b>다. attempt가 세션 시작보다 늦게 붙으면 stream-local 0이
 * 세션 축에서는 그 지연만큼 뒤이고, 앵커는 그 차이를 정확히 메운다.
 */
@ExtendWith(MockitoExtension.class)
class CaptionAnchorLookupTest {

    private static final UUID SESSION = UUID.randomUUID();
    private static final OffsetDateTime CLOCK_ORIGIN =
            OffsetDateTime.of(2026, 8, 1, 10, 0, 0, 0, ZoneOffset.UTC);

    @Mock
    private LiveCaptionRepository liveCaptionRepository;
    @Mock
    private SessionClockLookup sessionClockLookup;

    private CaptionAnchorLookup lookup;

    @BeforeEach
    void setUp() {
        lookup = new CaptionAnchorLookup(liveCaptionRepository, sessionClockLookup);
    }

    private static LiveCaption started(String sttSessionId, int secondsAfterOrigin) {
        LiveCaption row = new LiveCaption();
        row.setSttSessionId(sttSessionId);
        row.setAudioStartedAt(CLOCK_ORIGIN.plusSeconds(secondsAfterOrigin));
        return row;
    }

    private void givenStarted(LiveCaption... rows) {
        when(sessionClockLookup.clockOriginAt(SESSION)).thenReturn(CLOCK_ORIGIN);
        when(liveCaptionRepository.findBySessionIdAndEventTypeOrderByIdAsc(SESSION, CaptionEvent.TYPE_STARTED))
                .thenReturn(List.of(rows));
    }

    @Test
    void adds_attempt_anchor_to_stream_elapsed_ms() {
        givenStarted(started("stt-1", 7));   // STT가 세션 시작 7초 뒤에 붙었다

        // stream-local 42초 = 세션 축 49초. 근사(도착 시각)와 달리 지연이 섞이지 않는다.
        assertThat(lookup.anchoredSessionMs(SESSION, "stt-1", 42_000L)).isEqualTo(49_000L);
    }

    @Test
    void keeps_each_attempt_on_its_own_anchor() {
        // 재접속하면 stream-local이 0으로 리셋되므로 attempt마다 앵커가 따로다 —
        // 하나로 뭉뚱그리면 재접속 이후 자막이 통째로 앞으로 튄다.
        givenStarted(started("stt-1", 0), started("stt-2", 600));

        assertThat(lookup.anchoredSessionMs(SESSION, "stt-1", 5_000L)).isEqualTo(5_000L);
        assertThat(lookup.anchoredSessionMs(SESSION, "stt-2", 5_000L)).isEqualTo(605_000L);
    }

    @Test
    void first_started_defines_zero_when_repeated() {
        givenStarted(started("stt-1", 10), started("stt-1", 99));

        assertThat(lookup.anchoredSessionMs(SESSION, "stt-1", 0L)).isEqualTo(10_000L);
    }

    @Test
    void clamps_before_session_origin_to_zero() {
        givenStarted(started("stt-1", -30));   // 세션 전환 전에 오디오가 시작된 경우

        // 재생 축에 0 이전이 없다. 근사 축(CaptionSessionMs)과 같은 규칙이라 경계에서 어긋나지 않는다.
        assertThat(lookup.anchoredSessionMs(SESSION, "stt-1", 5_000L)).isZero();
    }

    @Test
    void returns_null_when_attempt_has_no_anchor() {
        givenStarted(started("stt-1", 5));

        // 지어내지 않는다 — 호출자가 근사로 물러난다.
        assertThat(lookup.anchoredSessionMs(SESSION, "stt-unknown", 1_000L)).isNull();
    }

    @Test
    void returns_null_without_clock_origin() {
        when(sessionClockLookup.clockOriginAt(SESSION)).thenReturn(null);

        assertThat(lookup.anchoredSessionMs(SESSION, "stt-1", 1_000L)).isNull();
    }

    @Test
    void returns_null_without_coordinates() {
        assertThat(lookup.anchoredSessionMs(SESSION, null, 1_000L)).isNull();
        assertThat(lookup.anchoredSessionMs(SESSION, "stt-1", null)).isNull();
        verify(liveCaptionRepository, never()).findBySessionIdAndEventTypeOrderByIdAsc(any(), any());
    }

    @Test
    void reads_anchors_once_per_session() {
        givenStarted(started("stt-1", 3));

        for (int i = 0; i < 5; i++) {
            lookup.anchoredSessionMs(SESSION, "stt-1", i * 1_000L);
        }

        // 자막 델타는 빈번하다. 매번 DB를 다시 뒤지면 라이브 브로드캐스트가 그만큼 느려진다.
        verify(liveCaptionRepository, times(1))
                .findBySessionIdAndEventTypeOrderByIdAsc(SESSION, CaptionEvent.TYPE_STARTED);
    }

    @Test
    void remembers_missing_attempts_so_legacy_sessions_do_not_requery() {
        when(sessionClockLookup.clockOriginAt(SESSION)).thenReturn(CLOCK_ORIGIN);
        when(liveCaptionRepository.findBySessionIdAndEventTypeOrderByIdAsc(eq(SESSION), any()))
                .thenReturn(List.of());

        for (int i = 0; i < 5; i++) {
            assertThat(lookup.anchoredSessionMs(SESSION, "stt-1", 1_000L)).isNull();
        }

        // 앵커가 아예 없는 옛 세션에서 델타마다 조회가 나가면 안 된다.
        verify(liveCaptionRepository, times(1))
                .findBySessionIdAndEventTypeOrderByIdAsc(SESSION, CaptionEvent.TYPE_STARTED);
    }
}
