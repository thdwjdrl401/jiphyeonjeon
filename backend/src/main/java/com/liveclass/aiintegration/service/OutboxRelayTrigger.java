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
     * 트리거가 띄운 패스가 지금 돌고 있는가. <b>동시에 최대 한 개</b>만 돌게 하는 실행 게이트다.
     *
     * <p>커밋 하나에 릴레이 한 번을 그대로 대응시키면, 알림 팬아웃처럼 짧은 트랜잭션이 몰릴 때
     * 패스가 그 수만큼 떠서 각자 커넥션을 잡는다. 처음에는 "대기 중인 패스만 합치고 실행 중과의
     * 동시 실행은 허용"으로 두었는데, 그 상한 없음이 CI에서 실제 사고가 됐다 — 커밋형 테스트가
     * 커밋할 때마다 패스가 쌓였고, 밀린 패스들이 <b>한참 뒤의 다른 테스트 위로</b> 겹치며
     * SessionFactory 전역인 Hibernate 통계를 오염시켜 쿼리 수 단언을 깨뜨렸다(간섭이 테스트라서
     * 보였을 뿐, 운영이라면 커넥션 풀 압박으로 나타났을 것이다).
     */
    private final AtomicBoolean running = new AtomicBoolean();

    /**
     * 패스가 끝난 뒤 <b>한 번 더</b> 돌아야 하는가. 실행 중에 도착한 깨우기를 잃지 않기 위한 표다.
     *
     * <p>실행 게이트만 두면 "패스가 도는 동안 커밋된 행"을 놓친다 — 그 행은 지금 패스의 스냅샷에
     * 없을 수 있는데 게이트가 새 패스를 막는다. 그래서 깨우기는 언제나 이 표를 먼저 세우고,
     * 도는 패스가 끝날 때 표가 서 있으면 <b>이어서 한 번 더</b> 훑는다. 몇 번의 커밋이 겹쳐도
     * 추가 패스는 한 번으로 합쳐진다 — 어차피 한 번이면 그 시점까지의 행을 전부 본다.
     */
    private final AtomicBoolean rerun = new AtomicBoolean();

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
        /*
         * 표를 먼저 세우고 게이트를 잡는다. 순서가 반대면 — 게이트 확인 뒤 표를 세우면 — 도는
         * 패스가 "표 검사 → 없음 → 게이트 해제" 사이에 이 깨우기가 끼어들어 통째로 사라질 수 있다.
         * 표가 먼저면 어느 쪽이든 잡힌다: 게이트를 내가 잡으면 새 패스가 표를 보고, 남이 잡고
         * 있으면 그 패스의 마무리 검사가 본다.
         */
        rerun.set(true);
        if (!running.compareAndSet(false, true)) {
            return;   // 패스가 돌고 있다 — 끝날 때 rerun 표를 보고 이어서 한 번 더 돈다.
        }
        submit();
    }

    private void submit() {
        try {
            executor.execute(this::runRelay);
        } catch (RuntimeException e) {
            // 실행기가 거절했다(종료 중 등). 게이트를 되돌려 다음 커밋이 다시 시도할 수 있게 한다.
            running.set(false);
            log.warn("outbox 릴레이 깨우기 실패 — 폴링을 기다린다: {}", e.getMessage());
        }
    }

    private void runRelay() {
        try {
            /*
             * 표가 서 있는 동안 이어서 돈다. 한 바퀴 도는 사이에 커밋이 몇 번 오든 표는 하나라
             * 추가 패스도 한 번이다 — 패스 수가 커밋 수가 아니라 "밀린 일이 있는가"에 비례한다.
             */
            while (rerun.getAndSet(false)) {
                try {
                    relay.publishPending();
                } catch (RuntimeException e) {
                    // 이미 업무 트랜잭션 밖이라 올려 봐야 받을 사람이 없다. 다음 폴링이 다시 집는다.
                    log.warn("outbox 릴레이 깨우기 실행 실패 — 폴링을 기다린다: {}", e.getMessage());
                    break;   // 같은 원인으로 곧장 또 돌지 않는다 — 남은 일은 폴링 몫이다.
                }
            }
        } finally {
            running.set(false);
            /*
             * 마무리 검사. while이 표를 내리고 게이트를 놓기 직전에 도착한 깨우기는 게이트가
             * 잡혀 있어 새 패스를 못 띄웠다 — 그 표가 남아 있으면 여기서 대신 띄운다.
             */
            if (rerun.get() && running.compareAndSet(false, true)) {
                submit();
            }
        }
    }
}
