package com.liveclass.aiintegration.config;

import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.amqp.core.AmqpAdmin;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * AI 인제스트 잡 큐 선언(ADR-0036, CONTRACT §3-1). 자료 임베딩 잡은 {@code ingestion.embed}로 간다
 * (taskType은 payload로 구분 — PPTX_EMBED·EMBED_DELETE). durable 큐라 소비자가 없어도 메시지가 남는다.
 * 파이프라인 스위치가 켜지면 Spring이 기동 중 큐를 먼저 선언해 worker와 첫 작업의 시작 순서에 의존하지 않는다.
 */
@Configuration
public class IngestionMessagingConfig {

    public static final String INGESTION_EMBED_QUEUE = "ingestion.embed";

    @Bean
    Queue ingestionEmbedQueue() {
        return QueueBuilder.durable(INGESTION_EMBED_QUEUE).build();
    }

    @Bean
    @ConditionalOnProperty(name = "material.embedding.enabled", havingValue = "true")
    ApplicationRunner declareIngestionTopology(AmqpAdmin amqpAdmin, Queue ingestionEmbedQueue) {
        return args -> amqpAdmin.declareQueue(ingestionEmbedQueue);
    }
}
