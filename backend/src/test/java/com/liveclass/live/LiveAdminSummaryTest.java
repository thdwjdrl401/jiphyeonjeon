package com.liveclass.live;

import com.liveclass.live.config.CaptionStreamProperties;
import com.liveclass.live.domain.LiveSession;
import com.liveclass.live.domain.LiveSessionStatus;
import com.liveclass.live.repository.LiveSessionRepository;
import com.liveclass.live.web.LiveAdminController;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.core.StreamOperations;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 운영 콘솔 라이브 요약의 <b>가용성</b> 규칙.
 *
 * <p>운영 화면은 문제가 생겼을 때 보는 화면이다. 그런데 그 화면이 "문제 하나 때문에" 통째로 실패하면
 * 정작 필요한 순간에 아무것도 못 본다 — 자막 Redis가 죽었을 때 라이브 세션 상태까지 같이 가려지는 식.
 * 그래서 부분 실패는 <b>그 칸만 비우고</b> 나머지는 그대로 준다는 것을 여기서 못 박는다.
 */
class LiveAdminSummaryTest {

    private final LiveSessionRepository sessionRepository = mock(LiveSessionRepository.class);
    private final StringRedisTemplate redis = mock(StringRedisTemplate.class);
    @SuppressWarnings("unchecked")
    private final StreamOperations<String, Object, Object> streamOps = mock(StreamOperations.class);
    private final CaptionStreamProperties captionProperties = new CaptionStreamProperties(
            true, "ai:captions:test", "spring-caption-test", null, "c1", 100, Duration.ofSeconds(1));

    private LiveAdminController controller() {
        return new LiveAdminController(sessionRepository, redis, captionProperties);
    }

    @Test
    void caption_stream_failure_does_not_hide_session_status() {
        List<Object[]> rows = List.<Object[]>of(new Object[]{LiveSessionStatus.ENDED, 3L});
        when(sessionRepository.countByStatus()).thenReturn(rows);
        when(sessionRepository.findByStatusInAndStartedAtBeforeOrderByStartedAtAsc(any(), any()))
                .thenReturn(List.of());
        // Redis가 죽은 상황.
        when(redis.opsForStream()).thenReturn(streamOps);
        when(streamOps.size(anyString())).thenThrow(new RedisConnectionFailureException("down"));

        var summary = controller().summary();

        assertThat(summary.captionStream().length())
                .as("자막 상태는 알 수 없음으로 비운다").isNull();
        assertThat(summary.byStatus())
                .as("세션 상태는 그대로 보여야 한다 — 자막 때문에 가려지면 안 된다")
                .anySatisfy(s -> {
                    assertThat(s.status()).isEqualTo("ENDED");
                    assertThat(s.count()).isEqualTo(3L);
                });
    }

    @Test
    void every_status_is_present_even_when_zero() {
        when(sessionRepository.countByStatus()).thenReturn(List.of());
        when(sessionRepository.findByStatusInAndStartedAtBeforeOrderByStartedAtAsc(any(), any()))
                .thenReturn(List.of());
        when(redis.opsForStream()).thenReturn(streamOps);
        when(streamOps.size(anyString())).thenReturn(0L);
        when(streamOps.groups(anyString())).thenReturn(null);

        var summary = controller().summary();

        // 0인 상태가 빠지면 "LIVE 0건"인지 "집계가 안 된 것"인지 화면에서 구분되지 않는다.
        assertThat(summary.byStatus()).hasSize(LiveSessionStatus.values().length);
    }

    @Test
    void stuck_sessions_are_reported_with_the_threshold_used() {
        UUID id = UUID.randomUUID();
        LiveSession session = new LiveSession();
        session.setId(id);
        session.setStatus(LiveSessionStatus.LIVE);
        session.setStartedAt(OffsetDateTime.now().minusHours(9));
        when(sessionRepository.countByStatus()).thenReturn(List.of());
        when(sessionRepository.findByStatusInAndStartedAtBeforeOrderByStartedAtAsc(any(), any()))
                .thenReturn(List.of(session));
        when(redis.opsForStream()).thenReturn(streamOps);
        when(streamOps.size(anyString())).thenReturn(0L);
        when(streamOps.groups(anyString())).thenReturn(null);

        var summary = controller().summary();

        assertThat(summary.stuck()).singleElement().satisfies(s -> {
            assertThat(s.sessionId()).isEqualTo(id);
            assertThat(s.status()).isEqualTo("LIVE");
        });
        // 화면이 "N시간 이상 진행 중"이라고 같은 기준으로 설명할 수 있어야 한다.
        assertThat(summary.stuckAfterHours()).isPositive();
    }
}
