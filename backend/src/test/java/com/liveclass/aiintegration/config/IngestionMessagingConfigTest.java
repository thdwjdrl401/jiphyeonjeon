package com.liveclass.aiintegration.config;

import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.AmqpAdmin;
import org.springframework.amqp.core.Queue;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

class IngestionMessagingConfigTest {

    @Test
    void queue_is_durable_and_owned_by_spring() {
        Queue queue = new IngestionMessagingConfig().ingestionEmbedQueue();

        assertThat(queue.getName()).isEqualTo("ingestion.embed");
        assertThat(queue.isDurable()).isTrue();
        assertThat(queue.isExclusive()).isFalse();
        assertThat(queue.isAutoDelete()).isFalse();
    }

    @Test
    void enabled_pipeline_declares_queue_before_accepting_work() throws Exception {
        AmqpAdmin amqpAdmin = mock(AmqpAdmin.class);

        new ApplicationContextRunner()
                .withUserConfiguration(IngestionMessagingConfig.class)
                .withBean(AmqpAdmin.class, () -> amqpAdmin)
                .withPropertyValues("material.embedding.enabled=true")
                .run(context -> {
                    ApplicationRunner runner = context.getBean(ApplicationRunner.class);
                    runner.run(null);

                    verify(amqpAdmin).declareQueue(context.getBean(Queue.class));
                });
    }

    @Test
    void disabled_pipeline_does_not_open_a_broker_connection() {
        AmqpAdmin amqpAdmin = mock(AmqpAdmin.class);

        new ApplicationContextRunner()
                .withUserConfiguration(IngestionMessagingConfig.class)
                .withBean(AmqpAdmin.class, () -> amqpAdmin)
                .withPropertyValues("material.embedding.enabled=false")
                .run(context -> assertThat(context).doesNotHaveBean(ApplicationRunner.class));
    }
}
