package com.liveclass.live.config;

import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.stream.Consumer;
import org.springframework.data.redis.stream.StreamMessageListenerContainer.ConsumerStreamReadRequest;
import org.springframework.data.redis.stream.StreamMessageListenerContainer.StreamReadRequest;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * poll 등록 정책 회귀 방지. Redis도 컨테이너도 없이 확인한다.
 *
 * <p>두 값이 회귀하면 <b>조용히</b> 망가진다 — 노트가 안 쌓이는 것으로만 드러나고 오류는 없다.
 * 자막 쪽에 같은 테스트가 있는 이유와 같다.
 */
class LectureNoteStreamConsumerReadRequestTest {

    private LectureNoteStreamConsumer consumer() {
        return new LectureNoteStreamConsumer(null, null, null,
                new LectureNoteStreamProperties(true, null, null, null, "test-consumer", null, null));
    }

    @Test
    void keeps_the_subscription_alive_when_a_poll_fails() {
        StreamReadRequest<String> request =
                consumer().readRequest("ai:lecture-notes:mvp", Consumer.from("g", "c"));

        // 기본값(t -> true)이면 네트워크가 한 번 끊겨도 poll 루프가 끝나 소비가 영구 정지한다.
        assertThat(request.getCancelSubscriptionOnError().test(new RuntimeException("일시 오류"))).isFalse();
    }

    @Test
    @SuppressWarnings("unchecked")
    void does_not_auto_acknowledge() {
        StreamReadRequest<String> request =
                consumer().readRequest("ai:lecture-notes:mvp", Consumer.from("g", "c"));

        // 자동 ACK면 갭인 조각까지 ACK되어 pending에 남지 않는다 → 앞 조각이 와도 이어지지 않는다.
        assertThat(request).isInstanceOf(ConsumerStreamReadRequest.class);
        assertThat(((ConsumerStreamReadRequest<String>) request).isAutoAcknowledge()).isFalse();
        // 새 엔트리만 읽는다(">"). 부팅 시 밀린 pending은 consumer가 따로 drain한다.
        assertThat(request.getStreamOffset().getOffset().getOffset()).isEqualTo(">");
    }

    @Test
    void the_group_name_is_the_one_the_contract_fixes() {
        LectureNoteStreamProperties properties =
                new LectureNoteStreamProperties(true, null, null, null, null, null, null);

        // ai-api가 자기 group으로 이미 소비 중이라 반드시 별도 그룹이어야 한다(CONTRACT §3-4a).
        assertThat(properties.effectiveGroup()).isEqualTo("spring-lecture-notes-live-v1");
        assertThat(properties.streamKey()).isEqualTo("ai:lecture-notes:mvp");
    }

    @Test
    void it_is_off_unless_explicitly_enabled() {
        // 켜는 순간 운영 노트가 쌓이기 시작한다. 환경별로 명시적으로 켠다.
        assertThat(new LectureNoteStreamProperties(null, null, null, null, null, null, null).enabledFlag())
                .isFalse();
        assertThat(new LectureNoteStreamProperties(true, null, null, null, null, null, null).enabledFlag())
                .isTrue();
    }
}
