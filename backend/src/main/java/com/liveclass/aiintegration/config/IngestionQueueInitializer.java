package com.liveclass.aiintegration.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.core.RabbitAdmin;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * 기동 시 {@code ingestion.embed} 큐를 결정론적으로 선언한다(ADR-0036).
 *
 * <p>기본 동작은 RabbitAdmin이 <b>브로커 첫 연결</b> 시점에 큐를 선언하는데(발행 전용이라 기동 중 연결을
 * 강제하지 않음), 그러면 AI 워커가 Spring보다 <b>먼저</b> 떠서 큐를 passive lookup 할 때 큐가 없어 실패할 수
 * 있다(워커-선기동 레이스). 스위치가 켜져 있으면 {@link ApplicationReadyEvent}에서 선언을 앞당겨 이 레이스를
 * 없앤다 — 인프라가 큐를 미리 만들 필요가 사라진다.
 *
 * <p><b>비치명적</b>: 브로커가 안 떠 있으면 경고만 남기고 계속한다("브로커 없이도 부팅" 성질 유지, 실제 선언은
 * 이후 첫 발행/재시도에서 이뤄짐). 스위치가 꺼져 있으면(기본) 아무것도 하지 않는다 — 브로커에 접속조차 안 해
 * 무회귀다. 큐 선언은 멱등(같은 durable 큐 재선언은 no-op).
 */
@Component
public class IngestionQueueInitializer {

    private static final Logger log = LoggerFactory.getLogger(IngestionQueueInitializer.class);

    private final ObjectProvider<RabbitAdmin> rabbitAdmin;
    private final boolean embeddingEnabled;

    public IngestionQueueInitializer(ObjectProvider<RabbitAdmin> rabbitAdmin,
                                     @Value("${material.embedding.enabled:false}") boolean embeddingEnabled) {
        this.rabbitAdmin = rabbitAdmin;
        this.embeddingEnabled = embeddingEnabled;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void declareQueuesOnStartup() {
        if (!embeddingEnabled) {
            return;   // 파이프라인 off(기본) → 브로커 접속 안 함(무회귀)
        }
        RabbitAdmin admin = rabbitAdmin.getIfAvailable();
        if (admin == null) {
            log.warn("RabbitAdmin 빈이 없어 ingestion.embed 큐 기동 선언을 건너뜀");
            return;
        }
        try {
            admin.initialize();   // 컨텍스트의 Declarable(=ingestion.embed durable 큐) 선언. 이미 있으면 no-op.
            log.info("ingestion.embed 큐 기동 시 선언 완료 — 워커 선기동 안전");
        } catch (RuntimeException e) {
            log.warn("기동 시 큐 선언 실패(브로커 미가동?) — 이후 발행/재시도에서 선언됨: {}", e.getMessage());
        }
    }
}
