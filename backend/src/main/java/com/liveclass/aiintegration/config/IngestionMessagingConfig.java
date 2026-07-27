package com.liveclass.aiintegration.config;

import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * AI 인제스트 잡 큐 선언(ADR-0036, CONTRACT §3-1). 자료 임베딩 잡은 {@code ingestion.embed}로 간다
 * (taskType은 payload로 구분 — PPTX_EMBED·EMBED_DELETE). durable 큐라 소비자가 없어도 메시지가 남는다.
 * 발행 전용이라 기본은 RabbitAdmin이 첫 연결 시 이 큐를 선언하지만, 스위치가 켜져 있으면
 * {@link IngestionQueueInitializer}가 기동 시 선언을 앞당겨 워커 선기동 레이스를 없앤다.
 */
@Configuration
public class IngestionMessagingConfig {

    public static final String INGESTION_EMBED_QUEUE = "ingestion.embed";

    @Bean
    Queue ingestionEmbedQueue() {
        return QueueBuilder.durable(INGESTION_EMBED_QUEUE).build();
    }
}
