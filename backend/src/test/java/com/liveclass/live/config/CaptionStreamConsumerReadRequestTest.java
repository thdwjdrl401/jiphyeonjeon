package com.liveclass.live.config;

import org.junit.jupiter.api.Test;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.connection.stream.Consumer;
import org.springframework.data.redis.stream.StreamMessageListenerContainer.ConsumerStreamReadRequest;
import org.springframework.data.redis.stream.StreamMessageListenerContainer.StreamReadRequest;

import java.io.IOException;
import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 자막 consumer 등록 정책 회귀 고정(ADR-0043 복원력 보강). Redis도 컨테이너도 없이 등록 요청만 검사한다.
 *
 * <p>지키는 것은 단 하나다 — Spring Data Redis 기본값
 * {@code StreamReadRequestBuilder.cancelSubscriptionOnError = t -> true}를 우리가 반드시 덮어써야 한다는 것.
 * 기본값이면 {@code StreamPollTask.doLoop()}가 poll 예외마다 구독을 {@code cancel()}하고
 * (errorHandler는 그 뒤에 호출될 뿐) 일시적 연결 오류 하나로 자막 소비가 재기동 전까지 영구 정지한다.
 * {@code receive(...)} 편의 메서드로 되돌리면 이 테스트가 깨진다.
 */
class CaptionStreamConsumerReadRequestTest {

    private static final String STREAM_KEY = "ai:captions:unit";
    private static final String GROUP = "spring-caption-unit";

    /** 배선 검사만 하므로 Redis 의존성은 필요 없다(생성자는 필드 대입만 한다). */
    private final CaptionStreamConsumer consumer =
            new CaptionStreamConsumer(null, null, null, properties());

    @Test
    void read_request_keeps_subscription_alive_on_error() {
        StreamReadRequest<String> request = consumer.readRequest(STREAM_KEY, Consumer.from(GROUP, "unit-1"));

        // 일시적 연결 오류(실측 장애의 정확한 타입)로도, 어떤 RuntimeException으로도 구독을 취소하지 않는다.
        assertThat(request.getCancelSubscriptionOnError()
                .test(new RedisConnectionFailureException("Unable to connect to Redis", new IOException("unreachable"))))
                .isFalse();
        assertThat(request.getCancelSubscriptionOnError().test(new IllegalStateException("boom"))).isFalse();
    }

    @Test
    void read_request_keeps_manual_ack_and_new_entries_offset() {
        StreamReadRequest<String> request = consumer.readRequest(STREAM_KEY, Consumer.from(GROUP, "unit-1"));

        assertThat(request).isInstanceOf(ConsumerStreamReadRequest.class);
        ConsumerStreamReadRequest<String> consumerRequest = (ConsumerStreamReadRequest<String>) request;
        // 수동 ACK 유지 — listener가 엔트리별로 XACK한다(ADR-0043 at-least-once).
        assertThat(consumerRequest.isAutoAcknowledge()).isFalse();
        assertThat(consumerRequest.getConsumer()).isEqualTo(Consumer.from(GROUP, "unit-1"));
        assertThat(request.getStreamOffset().getKey()).isEqualTo(STREAM_KEY);
        assertThat(request.getStreamOffset().getOffset().getOffset()).isEqualTo(">");
        // 오류가 조용히 사라지지 않도록 errorHandler가 반드시 붙어 있어야 한다(로깅 담당).
        assertThat(request.getErrorHandler()).isNotNull();
    }

    private static CaptionStreamProperties properties() {
        return new CaptionStreamProperties(true, STREAM_KEY, GROUP, null, "unit-1", 100, Duration.ofMillis(200));
    }
}
