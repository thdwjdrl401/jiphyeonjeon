package com.liveclass.aiintegration.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.task.AsyncTaskExecutor;
import org.springframework.core.task.SimpleAsyncTaskExecutor;

/**
 * 커밋 뒤 릴레이를 깨울 때 쓰는 실행기(ADR-0122).
 *
 * <p><b>호출 스레드를 붙잡으면 안 된다.</b> 깨우기는 수강 승인·자료 연결 같은 업무 요청이 커밋한
 * 직후에 일어나는데, 그 스레드에서 릴레이를 그대로 돌리면 요청이 <b>브로커 왕복이 끝날 때까지</b>
 * 응답하지 못한다. 아웃박스를 쓰는 이유가 업무를 발행에서 떼어 놓는 것인데 그러면 도로 붙는다.
 *
 * <p>릴레이는 대부분 대기(DB 왕복·AMQP 왕복)라 가상 스레드가 맞다 — 깨우기가 몰려도 플랫폼 스레드를
 * 그 수만큼 잡지 않는다.
 *
 * <p>부팅이 만들어 주는 {@code applicationTaskExecutor}를 그대로 쓰지 않은 이유는 둘이다. 그 실행기는
 * MVC 비동기 디스패치까지 함께 쓰는 공용이라 릴레이가 몰리면 <b>서로 다른 일이 같은 자원을 두고</b>
 * 겹치고, 스레드 이름이 뭉뜽그려져 운영 스레드 덤프에서 "지금 릴레이가 몇 개 떠 있나"를 셀 수 없다.
 */
@Configuration
public class OutboxAsyncConfig {

    public static final String OUTBOX_RELAY_EXECUTOR = "outboxRelayTaskExecutor";

    /**
     * 동시 실행 수를 제한하지 않는다. {@code SimpleAsyncTaskExecutor}의 concurrency limit은 한도에
     * 닿으면 {@code execute()}가 <b>호출 스레드를 블로킹</b>하는 방식이라, 여기서 켜면 막으려던
     * "업무 요청이 릴레이를 기다림"이 그대로 돌아온다. 몰림은 실행기가 아니라
     * {@code OutboxRelayTrigger}가 깨우기를 합쳐서 막는다.
     */
    @Bean(OUTBOX_RELAY_EXECUTOR)
    public AsyncTaskExecutor outboxRelayTaskExecutor() {
        SimpleAsyncTaskExecutor executor = new SimpleAsyncTaskExecutor("outbox-relay-");
        executor.setVirtualThreads(true);
        return executor;
    }
}
