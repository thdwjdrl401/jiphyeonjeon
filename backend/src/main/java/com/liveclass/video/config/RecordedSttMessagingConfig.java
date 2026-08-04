package com.liveclass.video.config;

import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class RecordedSttMessagingConfig {

    public static final String TRANSCRIBE_QUEUE = "ingestion.transcribe";
    public static final String TRANSCRIBE_DLQ = "ingestion.transcribe.dlq";

    @Bean
    Queue recordedSttQueue() {
        return QueueBuilder.durable(TRANSCRIBE_QUEUE)
                .deadLetterExchange("")
                .deadLetterRoutingKey(TRANSCRIBE_DLQ)
                .build();
    }

    @Bean
    Queue recordedSttDeadLetterQueue() {
        return QueueBuilder.durable(TRANSCRIBE_DLQ).build();
    }
}
