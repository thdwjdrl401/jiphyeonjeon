package com.liveclass.aiintegration;

import com.liveclass.aiintegration.config.IngestionQueueInitializer;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.AmqpConnectException;
import org.springframework.amqp.rabbit.core.RabbitAdmin;
import org.springframework.beans.factory.ObjectProvider;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 큐 기동 선언기(ADR-0036) 단위 검증: 스위치 off면 브로커 미접속(무회귀), on이면 선언,
 * 브로커 미가동이어도 비치명적(예외 전파 안 함).
 */
class IngestionQueueInitializerTest {

    @SuppressWarnings("unchecked")
    private ObjectProvider<RabbitAdmin> providerOf(RabbitAdmin admin) {
        ObjectProvider<RabbitAdmin> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(admin);
        return provider;
    }

    @Test
    void switch_off_does_not_touch_broker() {
        RabbitAdmin admin = mock(RabbitAdmin.class);
        ObjectProvider<RabbitAdmin> provider = providerOf(admin);

        new IngestionQueueInitializer(provider, false).declareQueuesOnStartup();

        verify(provider, never()).getIfAvailable();
        verify(admin, never()).initialize();
    }

    @Test
    void switch_on_declares_queue() {
        RabbitAdmin admin = mock(RabbitAdmin.class);

        new IngestionQueueInitializer(providerOf(admin), true).declareQueuesOnStartup();

        verify(admin).initialize();
    }

    @Test
    void switch_on_but_broker_down_is_non_fatal() {
        RabbitAdmin admin = mock(RabbitAdmin.class);
        doThrow(new AmqpConnectException(new RuntimeException("broker down"))).when(admin).initialize();

        assertThatCode(() -> new IngestionQueueInitializer(providerOf(admin), true).declareQueuesOnStartup())
                .doesNotThrowAnyException();
    }

    @Test
    void switch_on_but_no_admin_bean_is_non_fatal() {
        assertThatCode(() -> new IngestionQueueInitializer(providerOf(null), true).declareQueuesOnStartup())
                .doesNotThrowAnyException();
    }
}
