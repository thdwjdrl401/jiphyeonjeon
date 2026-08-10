package com.liveclass.live.service;

import com.liveclass.live.domain.LiveSession;
import com.liveclass.live.domain.LiveSessionStatus;
import com.liveclass.live.repository.LiveSessionRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 아무도 없는 라이브를 끝낸다(ADR-0119). 시작 쪽의 {@link LiveStartReconciler}에 대응하는 종료 쪽 루프다.
 *
 * <p><b>왜 webhook만으로는 안 되나.</b> {@code room_finished}는 방이 <b>비어야</b> 온다. 강사가 창을
 * 닫아도 학생이 남아 있으면 방은 살아 있고 신호가 오지 않는다 — 세션은 LIVE인 채로 남고, 그 방과
 * Egress가 계속 전역 슬롯을 문다.
 *
 * <p><b>왜 곧바로 끝내지 않나.</b> 방이 비었다는 관측 하나로는 끊긴 것인지 잠깐 끊긴 것인지 모른다.
 * 강사가 새로고침하거나 네트워크가 튀면 수십 초 동안 방이 빈다. 그래서 <b>비어 있기 시작한 시각</b>을
 * 기억해 두고 {@code empty-grace}가 지나야 종료한다.
 *
 * <p>그 기억은 메모리에만 둔다. 재시작하면 타이머가 처음부터 다시 도는데, 그 방향의 오차는
 * <b>안전한 쪽</b>이다 — 늦게 끝낼지언정 살아 있는 강의를 끊지 않는다.
 */
@Component
public class LiveEndReconciler {

    private static final Logger log = LoggerFactory.getLogger(LiveEndReconciler.class);

    /** 한 번에 볼 세션 수. 방마다 LiveKit 조회가 한 번씩 나가므로 상한을 둔다. */
    private static final int BATCH = 20;

    private static final List<LiveSessionStatus> IN_PROGRESS =
            List.of(LiveSessionStatus.LIVE, LiveSessionStatus.ENDING);

    /** 세션별로 "언제부터 비어 있었나". 사람이 돌아오면 지운다. */
    private final Map<UUID, OffsetDateTime> emptySince = new ConcurrentHashMap<>();

    private final LiveSessionRepository liveSessionRepository;
    private final LiveRoomControl roomControl;
    private final LiveEndOrchestrator endOrchestrator;
    private final Duration startGrace;
    private final Duration emptyGrace;

    public LiveEndReconciler(LiveSessionRepository liveSessionRepository,
                             LiveRoomControl roomControl,
                             LiveEndOrchestrator endOrchestrator,
                             @Value("${live.end.start-grace:2m}") Duration startGrace,
                             @Value("${live.end.empty-grace:12m}") Duration emptyGrace,
                             @Value("${livekit.room-departure-timeout-seconds:600}") int departureSeconds) {
        this.liveSessionRepository = liveSessionRepository;
        this.roomControl = roomControl;
        this.endOrchestrator = endOrchestrator;
        this.startGrace = startGrace;
        this.emptyGrace = atLeastDepartureTimeout(emptyGrace, departureSeconds);
    }

    /**
     * <b>방 이탈 유예보다 짧게 끊지 않는다.</b>
     *
     * <p>{@code livekit.room-departure-timeout-seconds}는 강사가 끊긴 뒤에도 방을 열어 두는 시간이고,
     * 기본값 10분은 "와이파이 전환처럼 수십 초 끊기는 일이 흔하다"는 이유로 LiveKit 기본값(20초)에서
     * 일부러 올린 값이다. 그동안 방은 비어 있다 — 돌아올 사람을 기다리는 중이라서다.
     *
     * <p>여기서 그보다 먼저 끊으면 <b>그 결정을 무효로 만든다.</b> 강사가 8분 만에 돌아왔는데
     * 세션이 이미 ENDED면, 방을 10분 열어 둔 의미가 없다. 그래서 설정이 더 짧게 잡혀 있으면
     * 여기서 끌어올리고, 왜 그랬는지 남긴다.
     */
    private static Duration atLeastDepartureTimeout(Duration configured, int departureSeconds) {
        // 하한은 방 정책이 포기하는 시점 그대로다. 그 위의 여유는 코드가 아니라 설정값이 준다
        // (기본 12분 = 이탈 유예 10분 + 2분). 여기서 여유까지 더하면 두 군데가 같은 값을 정한다.
        Duration floor = Duration.ofSeconds(departureSeconds);
        if (configured.compareTo(floor) >= 0) {
            return configured;
        }
        log.warn("live.end.empty-grace({})가 방 이탈 유예({}s)보다 짧아 {}로 올린다 — "
                        + "그 전에 끊으면 돌아올 강사를 기다리는 의미가 없다",
                configured, departureSeconds, floor);
        return floor;
    }

    @Scheduled(fixedDelayString = "${live.end.reconcile-fixed-delay:60s}",
            initialDelayString = "${live.end.reconcile-initial-delay:45s}")
    public void reconcile() {
        OffsetDateTime now = OffsetDateTime.now();
        /*
         * 방금 시작한 세션은 보지 않는다. 시작 직후에는 강사 publisher가 아직 안 붙어 방이 비어
         * 보일 수 있는데, 그걸 "끊긴 강의"로 읽으면 시작하자마자 끝내 버린다.
         */
        List<LiveSession> candidates = liveSessionRepository
                .findByStatusInAndStartedAtBeforeOrderByStartedAtAsc(IN_PROGRESS, now.minus(startGrace))
                .stream()
                .limit(BATCH)
                .toList();

        Set<UUID> seen = new HashSet<>();
        for (LiveSession session : candidates) {
            UUID sessionId = session.getId();
            seen.add(sessionId);
            if (!isEmpty(sessionId)) {
                emptySince.remove(sessionId);
                continue;
            }
            OffsetDateTime since = emptySince.putIfAbsent(sessionId, now);
            if (since == null) {
                log.info("라이브 방이 비었음 — 관찰 시작 session={}", sessionId);
                continue;
            }
            if (Duration.between(since, now).compareTo(emptyGrace) < 0) {
                continue;
            }
            // 끝났든(정상) 손댈 상태가 아니든(강사가 먼저 끝냈다) 이 세션은 더 볼 이유가 없다.
            endOrchestrator.endBySystem(sessionId, "방이 " + emptyGrace + " 이상 비어 있음");
            emptySince.remove(sessionId);
        }

        /*
         * 후보에서 빠진 세션의 기억은 지운다. 다만 BATCH에 걸려 못 본 세션까지 잊으면 그 타이머가
         * 계속 초기화되므로, <b>전부 봤을 때만</b> 정리한다.
         */
        if (candidates.size() < BATCH) {
            emptySince.keySet().retainAll(seen);
        }
    }

    /**
     * 방에 아무도 없는가. <b>방이 없는 경우도 여기 포함된다</b> — LiveRoomControl은 없는 방에
     * 빈 목록을 준다. 둘은 우리에게 같은 뜻이다: 이 강의에는 아무도 없다.
     *
     * <p>LiveKit 조회가 실패하면 <b>비었다고 보지 않는다</b>. 우리 쪽 장애로 살아 있는 강의를
     * 끊는 것이 유령 세션을 몇 분 더 두는 것보다 나쁘다.
     */
    private boolean isEmpty(UUID sessionId) {
        try {
            return roomControl.listParticipants(LiveSessionService.roomName(sessionId)).isEmpty();
        } catch (RuntimeException e) {
            log.warn("라이브 방 조회 실패 — 이번 주기는 건너뜀 session={}: {}", sessionId, e.toString());
            return false;
        }
    }
}
