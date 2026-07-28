package com.liveclass.live.service;

import com.liveclass.live.repository.LiveStartAttemptRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.OffsetDateTime;

/**
 * 커밋 후 즉시 trigger가 유실되거나 Spring이 게이트 중 재시작된 경우의 복구 루프(ADR-0002 §3).
 *
 * <p>조회는 후보를 찾을 뿐이고, 실제 독점 실행은 {@link LiveStartTransitions#claim}의 DB row lock과
 * lease가 보장한다. 한 번에 50개만 집어 장애 뒤 thundering herd를 제한한다.
 */
@Component
public class LiveStartReconciler {

    private static final Logger log = LoggerFactory.getLogger(LiveStartReconciler.class);

    private final LiveStartAttemptRepository attemptRepository;
    private final LiveStartOrchestrator orchestrator;

    public LiveStartReconciler(LiveStartAttemptRepository attemptRepository,
                               LiveStartOrchestrator orchestrator) {
        this.attemptRepository = attemptRepository;
        this.orchestrator = orchestrator;
    }

    @Scheduled(
            fixedDelayString = "${live.start.reconcile-fixed-delay:10s}",
            initialDelayString = "${live.start.reconcile-initial-delay:20s}")
    public void reconcile() {
        var recoverable = attemptRepository.findRecoverable(OffsetDateTime.now(), PageRequest.of(0, 50));
        if (!recoverable.isEmpty()) {
            log.info("재조정할 라이브 시작 시도 {}건", recoverable.size());
        }
        recoverable.forEach(attempt -> orchestrator.runStartGatesByAttempt(attempt.getId()));
    }
}
