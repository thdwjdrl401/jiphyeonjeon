package com.liveclass.live.web;

import com.liveclass.live.config.CaptionStreamProperties;
import com.liveclass.live.domain.LiveSession;
import com.liveclass.live.domain.LiveSessionStatus;
import com.liveclass.live.repository.LiveSessionRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 운영 콘솔의 라이브 현황(읽기 전용). ADMIN 전용 경로({@code /api/admin/**}).
 *
 * <p>여기서 답하려는 질문은 둘이다.
 * <ol>
 *   <li><b>끝나지 않은 세션이 있는가?</b> 진행 계열(STARTING/LIVE/ENDING)에 오래 머문 세션은 종료 경로가
 *       끊긴 것이고, 그 세션의 방과 Egress가 계속 살아 <b>전역 Egress 슬롯을 물어</b> 다음 강의를 막는다.</li>
 *   <li><b>자막이 실제로 소비되고 있는가?</b> 자막은 Redis Stream을 Spring이 소비해 저장·중계한다. 소비자가
 *       죽어도 화면에는 "자막이 아직 없음"으로 보여 정상과 구분되지 않는다. 미처리(pending)와 스트림 길이를
 *       같이 보면 "안 오는 것"과 "못 따라가는 것"이 갈린다.</li>
 * </ol>
 *
 * <p>판정(몇 시간이면 이상인가)은 화면이 한다. 여기서는 사실과 그 사실을 재는 기준값만 준다.
 */
@RestController
@RequestMapping("/api/admin/live")
public class LiveAdminController {

    private static final Logger log = LoggerFactory.getLogger(LiveAdminController.class);

    /** 진행 계열 — 이 상태로 오래 남아 있으면 종료 경로가 끊긴 것이다. */
    private static final List<LiveSessionStatus> IN_PROGRESS =
            List.of(LiveSessionStatus.STARTING, LiveSessionStatus.LIVE, LiveSessionStatus.ENDING);

    /** 갇힘 판정 기준. 한 강의가 이보다 길기는 어렵다. */
    private static final Duration STUCK_AFTER = Duration.ofHours(6);

    private final LiveSessionRepository sessionRepository;
    private final StringRedisTemplate redis;
    private final CaptionStreamProperties captionProperties;

    public LiveAdminController(LiveSessionRepository sessionRepository,
                               StringRedisTemplate redis,
                               CaptionStreamProperties captionProperties) {
        this.sessionRepository = sessionRepository;
        this.redis = redis;
        this.captionProperties = captionProperties;
    }

    @GetMapping("/summary")
    public LiveSummary summary() {
        Map<LiveSessionStatus, Long> counts = new EnumMap<>(LiveSessionStatus.class);
        for (LiveSessionStatus status : LiveSessionStatus.values()) {
            counts.put(status, 0L);
        }
        for (Object[] row : sessionRepository.countByStatus()) {
            counts.put((LiveSessionStatus) row[0], (Long) row[1]);
        }

        OffsetDateTime threshold = OffsetDateTime.now().minus(STUCK_AFTER);
        List<StuckSession> stuck = sessionRepository
                .findByStatusInAndStartedAtBeforeOrderByStartedAtAsc(IN_PROGRESS, threshold)
                .stream()
                .map(s -> new StuckSession(s.getId(), s.getStatus().name(), s.getStartedAt()))
                .toList();

        return new LiveSummary(
                counts.entrySet().stream()
                        .map(e -> new StatusCount(e.getKey().name(), e.getValue()))
                        .toList(),
                stuck,
                STUCK_AFTER.toHours(),
                captionStream());
    }

    /**
     * 자막 스트림·소비 그룹 상태. Redis가 없거나 스트림/그룹이 아직 없으면(강의를 한 번도 안 했으면)
     * 예외 대신 {@code null}을 채워 보낸다 — 운영 화면이 이것 하나 때문에 통째로 실패하면 안 된다.
     */
    private CaptionStream captionStream() {
        String key = captionProperties.streamKey();
        String group = captionProperties.effectiveGroup();
        Long length = null;
        Long pending = null;
        boolean groupExists = false;
        try {
            length = redis.opsForStream().size(key);
            var groups = redis.opsForStream().groups(key);
            if (groups != null) {
                for (var g : groups) {
                    if (group.equals(g.groupName())) {
                        groupExists = true;
                        pending = g.pendingCount();
                    }
                }
            }
        } catch (RuntimeException e) {
            // 조회 실패 자체는 운영 정보다 — 화면을 막지 않고 "알 수 없음"으로 넘긴다.
            log.warn("자막 스트림 상태 조회 실패 key={} group={}: {}", key, group, e.getMessage());
        }
        return new CaptionStream(key, group, captionProperties.enabledFlag(), groupExists, length, pending);
    }

    /**
     * @param byStatus       상태별 세션 수(0인 상태도 포함)
     * @param stuck          진행 계열로 오래 남은 세션
     * @param stuckAfterHours 갇힘 판정 기준 시간 — 화면이 같은 기준으로 설명할 수 있게 함께 준다
     * @param captionStream  자막 스트림·소비 그룹 상태
     */
    public record LiveSummary(List<StatusCount> byStatus, List<StuckSession> stuck,
                              long stuckAfterHours, CaptionStream captionStream) {
    }

    public record StatusCount(String status, long count) {
    }

    public record StuckSession(UUID sessionId, String status, OffsetDateTime startedAt) {
    }

    /**
     * @param enabled     이 배포에서 자막 소비가 켜져 있는가(꺼져 있으면 pending이 쌓여도 정상이다)
     * @param groupExists 소비 그룹이 만들어졌는가(한 번도 소비하지 않았으면 없다)
     * @param length      스트림에 남아 있는 엔트리 수. 알 수 없으면 null
     * @param pending     소비 그룹의 미처리 수. 알 수 없으면 null
     */
    public record CaptionStream(String streamKey, String group, boolean enabled,
                                boolean groupExists, Long length, Long pending) {
    }
}
