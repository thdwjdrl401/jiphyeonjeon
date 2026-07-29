package com.liveclass.live.service;

import com.liveclass.live.api.LiveSessionStartingEvent;
import com.liveclass.live.config.LiveAsyncConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 시작 트랜잭션이 커밋된 뒤 게이트를 <b>별도 스레드</b>에서 돌린다(ADR-0002 §2).
 *
 * <p>{@code @Async}가 핵심이다. {@code AFTER_COMMIT} 리스너는 기본적으로 커밋한 스레드(=HTTP 요청 스레드)에서
 * 그대로 실행되므로, 이게 없으면 컨트롤러가 Egress 준비 수십 초를 기다리다 202를 늦게 돌려주고
 * 재클릭·프록시 timeout 위험이 생긴다. Egress보다 강사 publish가 먼저라는 순서는 별도의 실제
 * preflight gate가 보장한다.
 *
 * <p>얇은 글루다 — 실제 게이트 로직은 {@link LiveStartOrchestrator}가 소유한다.
 */
@Component
public class LiveStartGateExecutor {

    private static final Logger log = LoggerFactory.getLogger(LiveStartGateExecutor.class);

    private final LiveStartOrchestrator orchestrator;

    public LiveStartGateExecutor(LiveStartOrchestrator orchestrator) {
        this.orchestrator = orchestrator;
    }

    @Async(LiveAsyncConfig.LIVE_START_EXECUTOR)
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onSessionStarting(LiveSessionStartingEvent event) {
        try {
            orchestrator.runStartGates(event);
        } catch (RuntimeException e) {
            // 오케스트레이터가 이미 실패를 기록하지만, 여기서 새면 비동기 스레드에서 조용히 사라진다.
            log.error("시작 게이트 실행 중 처리되지 않은 오류 session={}: {}", event.sessionId(), e.getMessage(), e);
        }
    }
}
