package com.liveclass.video.config;

import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** 녹화강의 변환 큐는 AI ingestion 큐와 consumer·재시도·DLQ를 공유하지 않는다. */
@Configuration
public class MediaTranscodeMessagingConfig {

    public static final String TRANSCODE_QUEUE = "media.transcode";
    public static final String TRANSCODE_DLQ = "media.transcode.dlq";

    @Bean
    Queue mediaTranscodeQueue() {
        return QueueBuilder.durable(TRANSCODE_QUEUE)
                .deadLetterExchange("")
                .deadLetterRoutingKey(TRANSCODE_DLQ)
                .build();
    }

    @Bean
    Queue mediaTranscodeDeadLetterQueue() {
        return QueueBuilder.durable(TRANSCODE_DLQ).build();
    }
}
