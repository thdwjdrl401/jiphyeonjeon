package com.liveclass.live.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.task.AsyncTaskExecutor;
import org.springframework.core.task.SimpleAsyncTaskExecutor;
import org.springframework.scheduling.annotation.EnableAsync;

/**
 * 시작 게이트 실행용 비동기 인프라(ADR-0002 §2).
 *
 * <p>{@code /start}는 202를 즉시 돌려주고 STT dispatch·Egress Gate A~C·Gate S3는 커밋 후 <b>다른 스레드</b>에서
 * 진행해야 한다. 지금까지 {@code @TransactionalEventListener(AFTER_COMMIT)}가 커밋한 스레드(=HTTP 요청 스레드)에서
 * 그대로 실행돼 Egress가 강사 publish보다 먼저 돌던 것이 ADR §2가 지적한 버그의 근원이다.
 *
 * <p>게이트는 대부분 대기(polling·HTTP)라 가상 스레드가 적합하다 — 45초 대기가 플랫폼 스레드를 붙잡지 않는다.
 */
@Configuration
@EnableAsync
public class LiveAsyncConfig {

    public static final String LIVE_START_EXECUTOR = "liveStartTaskExecutor";

    @Bean(LIVE_START_EXECUTOR)
    public AsyncTaskExecutor liveStartTaskExecutor() {
        SimpleAsyncTaskExecutor executor = new SimpleAsyncTaskExecutor("live-start-");
        executor.setVirtualThreads(true);
        return executor;
    }
}
