package com.liveclass.aiintegration.service;

import com.liveclass.aiintegration.config.OutboxAsyncConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.task.AsyncTaskExecutor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 아웃박스에 잡이 실리면 <b>커밋된 뒤에</b> 릴레이를 깨운다(ADR-0122).
 *
 * <p>전에는 잡이 실려도 다음 폴링까지 아무 일도 일어나지 않았다. 폴링 주기를 줄이면 그만큼 빈
 * 조회가 늘고, 늘리면 자료를 올리고 임베딩이 시작되기까지가 눈에 보이게 늦어진다. 커밋이 곧
 * 신호이므로 <b>기다릴 이유가 없다</b> — 잡이 실린 순간을 아는 쪽이 알려 주면 된다.
 *
 * <p><b>{@code beforeCommit}이 아니라 {@code afterCommit}이다.</b> 커밋 전에 깨우면 릴레이는 다른
 * 트랜잭션에서 아직 커밋되지 않은 행을 읽으러 가서 <b>아무것도 못 보고</b> 돌아온다 — 깨운 값이 0이
 * 되고, 그 잡은 결국 폴링을 기다린다.
 *
 * <p><b>깨우기는 최선 노력이다.</b> 여기서 무엇이 실패해도 업무 트랜잭션은 이미 커밋됐고 되돌릴 수
 * 없으므로 예외를 올리지 않는다. {@code afterCommit}에서 던진 예외는 커밋을 부른 쪽으로 그대로
 * 전파되므로 — 즉 <b>성공한 수강 승인이 500으로 보이게 된다</b> — 삼키고 로그만 남긴다. 한 번 놓치면
 * 폴링이 늦게라도 집는다.
 */
@Component
public class OutboxRelayTrigger {

    private static final Logger log = LoggerFactory.getLogger(OutboxRelayTrigger.class);

    private final OutboxRelay relay;
    private final AsyncTaskExecutor executor;

    /**
     * 아직 시작하지 않은 깨우기가 떠 있는가. <b>대기 중인 패스를 하나로 합쳐</b> 깨우기 폭주를
     * 누그러뜨리기 위한 것이다.
     *
     * <p>커밋 하나에 릴레이 한 번을 그대로 대응시키면, 알림 팬아웃처럼 짧은 트랜잭션이 몰릴 때
     * 패스가 그 수만큼 뜨고 각자 커넥션을 하나씩 잡는다. 대기 중인 패스가 있으면 그 패스가 어차피
     * 훑을 것이므로 새로 띄우지 않는다.
     *
     * <p><b>합쳐지는 것은 대기 중인 패스뿐이다.</b> 깃발은 패스가 <b>시작할 때</b> 내려간다 — 그래야
     * 그 뒤에 커밋된 행이 지금 도는 패스의 스냅샷에서 빠지더라도 새 패스가 집는다. 대신 <b>실행 중인
     * 패스와의 동시 실행은 막지 않는다</b>(막으면 진행 중 커밋된 행을 놓친다). 커밋이 연달아 오면
     * 동시에 도는 패스가 여럿이 되고 그만큼 커넥션을 잡으므로, 동시 패스 수의 상한은 <b>여기서
     * 보장되지 않는다</b>. 정합성은 {@code FOR UPDATE SKIP LOCKED}가 지키니 남는 것은 순수한 커넥션
     * 압박이고, 그 상한이 필요해지면 세대 카운터나 실행 게이트를 들여야 한다 — 이번 범위는 아니다.
     */
    private final AtomicBoolean wakeupPending = new AtomicBoolean();

    public OutboxRelayTrigger(OutboxRelay relay,
                              @Qualifier(OutboxAsyncConfig.OUTBOX_RELAY_EXECUTOR) AsyncTaskExecutor executor) {
        this.relay = relay;
        this.executor = executor;
    }

    /**
     * 지금 트랜잭션이 커밋되면 릴레이를 깨운다. 트랜잭션 밖에서 부르면 곧바로 깨운다 — 기다릴
     * 커밋이 없다({@code WsNotificationBroadcaster}와 같은 분기).
     *
     * <p>한 트랜잭션이 잡을 여러 건 실어도 깨우기는 한 번이면 된다. 이미 걸어 둔 콜백이 있으면
     * 더 걸지 않는다.
     */
    public void wakeAfterCommit() {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            wake();
            return;
        }
        for (TransactionSynchronization registered : TransactionSynchronizationManager.getSynchronizations()) {
            if (registered instanceof WakeOnCommit) {
                return;
            }
        }
        TransactionSynchronizationManager.registerSynchronization(new WakeOnCommit());
    }

    private final class WakeOnCommit implements TransactionSynchronization {
        @Override
        public void afterCommit() {
            wake();
        }
    }

    private void wake() {
        if (!wakeupPending.compareAndSet(false, true)) {
            return;   // 아직 시작하지 않은 패스가 있다 — 그 패스가 이 행까지 본다.
        }
        try {
            executor.execute(this::runRelay);
        } catch (RuntimeException e) {
            // 실행기가 거절했다(종료 중 등). 깃발을 되돌려 다음 커밋이 다시 시도할 수 있게 한다.
            wakeupPending.set(false);
            log.warn("outbox 릴레이 깨우기 실패 — 폴링을 기다린다: {}", e.getMessage());
        }
    }

    private void runRelay() {
        wakeupPending.set(false);
        try {
            relay.publishPending();
        } catch (RuntimeException e) {
            // 여기는 이미 업무 트랜잭션 밖이라 올려 봐야 받을 사람이 없다. 다음 폴링이 다시 집는다.
            log.warn("outbox 릴레이 깨우기 실행 실패 — 폴링을 기다린다: {}", e.getMessage());
        }
    }
}
