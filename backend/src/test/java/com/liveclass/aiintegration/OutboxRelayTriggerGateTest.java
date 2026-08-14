package com.liveclass.aiintegration;

import com.liveclass.aiintegration.service.OutboxRelay;
import com.liveclass.aiintegration.service.OutboxRelayTrigger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

/**
 * 트리거 실행 게이트의 계약(ADR-0122). <b>동시에 패스는 최대 하나, 실행 중 깨우기는 끝난 뒤
 * 한 번으로 합쳐진다.</b>
 *
 * <p>이 계약이 없던 첫 구현은 실행 중 패스와의 동시 실행을 허용했고, CI에서 커밋형 테스트가
 * 커밋할 때마다 패스가 쌓여 <b>한참 뒤의 다른 테스트</b> 위로 겹쳤다 — SessionFactory 전역인
 * Hibernate 통계가 오염되어 쿼리 수 단언이 깨졌다. 운영이라면 커넥션 풀 압박으로 나타났을
 * 결함이 테스트라서 먼저 보인 것이다.
 *
 * <p>동기 실행기로 돌려 스레드 없이 결정적으로 검증한다 — 실행 중 재진입은 릴레이 목이
 * {@code publishPending} 안에서 트리거를 다시 깨우는 것으로 재현한다.
 */
class OutboxRelayTriggerGateTest {

    private OutboxRelay relay;
    private OutboxRelayTrigger trigger;

    @BeforeEach
    void setUp() {
        relay = mock(OutboxRelay.class);
        // 호출 스레드에서 그대로 도는 동기 실행기 — 스레드 없이 게이트 의미론만 본다.
        trigger = new OutboxRelayTrigger(relay, Runnable::run);
    }

    @Test
    void 깨우기_한_번은_패스_한_번이다() {
        trigger.wakeAfterCommit();   // 트랜잭션 밖 → 즉시 실행 분기

        verify(relay, times(1)).publishPending();
    }

    @Test
    void 실행_중에_온_깨우기는_끝난_뒤_한_번_더_돈다() {
        AtomicInteger calls = new AtomicInteger();
        doAnswer(invocation -> {
            // 첫 패스가 도는 동안 커밋이 하나 더 완료된 상황.
            if (calls.incrementAndGet() == 1) {
                trigger.wakeAfterCommit();
            }
            return null;
        }).when(relay).publishPending();

        trigger.wakeAfterCommit();

        // 놓치지 않되(2번째 패스가 그 커밋을 본다), 그 이상 돌지도 않는다.
        verify(relay, times(2)).publishPending();
    }

    @Test
    void 실행_중_깨우기_여러_번은_한_번으로_합쳐진다() {
        AtomicInteger calls = new AtomicInteger();
        doAnswer(invocation -> {
            if (calls.incrementAndGet() == 1) {
                // 짧은 트랜잭션 셋이 연달아 커밋됐다 — 패스가 커밋 수만큼 뜨면 안 된다.
                trigger.wakeAfterCommit();
                trigger.wakeAfterCommit();
                trigger.wakeAfterCommit();
            }
            return null;
        }).when(relay).publishPending();

        trigger.wakeAfterCommit();

        // 추가 패스는 한 번이다. 한 번이면 그 시점까지 커밋된 행을 전부 본다.
        verify(relay, times(2)).publishPending();
    }

    @Test
    void 패스가_터져도_게이트가_풀려_다음_깨우기가_돈다() {
        AtomicInteger calls = new AtomicInteger();
        doAnswer(invocation -> {
            if (calls.incrementAndGet() == 1) {
                throw new IllegalStateException("브로커가 잠깐 죽었다");
            }
            return null;
        }).when(relay).publishPending();

        trigger.wakeAfterCommit();   // 터진다 — 삼켜지고 게이트는 풀려야 한다
        trigger.wakeAfterCommit();   // 다음 깨우기가 정상 실행

        verify(relay, times(2)).publishPending();
    }

    @Test
    void 실행_중_깨우기와_실패가_겹치면_남은_일은_폴링_몫이다() {
        AtomicInteger calls = new AtomicInteger();
        doAnswer(invocation -> {
            if (calls.incrementAndGet() == 1) {
                trigger.wakeAfterCommit();
                throw new IllegalStateException("브로커가 잠깐 죽었다");
            }
            return null;
        }).when(relay).publishPending();

        trigger.wakeAfterCommit();

        /*
         * 실패 직후 같은 원인으로 곧장 또 돌지 않는다(break) — 마무리 검사가 남은 표를 보고
         * 새 패스를 띄우는 것까지가 계약이다. 그 패스는 성공하므로 총 2회.
         */
        verify(relay, times(2)).publishPending();
    }
}
