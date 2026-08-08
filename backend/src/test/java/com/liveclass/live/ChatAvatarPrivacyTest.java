package com.liveclass.live;

import com.liveclass.live.domain.ChatMessage;
import com.liveclass.live.web.dto.ChatMessageResponse;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 익명 메시지에 프로필 사진이 실리지 않는다는 불변식.
 *
 * <p>이름을 가려도 <b>사진이 실리면 사람이 특정된다.</b> 같은 강의를 듣는 사람들끼리는 얼굴을 알고,
 * 프로필 사진은 대개 얼굴이다. 그래서 익명 발언에 사진을 붙이면 익명이 아니게 된다(ADR-0050).
 *
 * <p>이 판단을 호출자에게 맡기지 않았다 — {@code ChatMessageResponse.from}이 익명이면 지도를
 * <b>보지도 않는다</b>. 그래서 익명 발신자의 URL이 실수로 지도에 섞여 들어와도 새어 나갈 길이 없다.
 * 여기서 확인하는 것이 정확히 그 성질이다: <b>지도에 값이 있는데도</b> 나가지 않는가.
 */
class ChatAvatarPrivacyTest {

    private static final UUID SENDER = UUID.randomUUID();
    private static final String AVATAR = "https://example.test/avatar.png";

    private ChatMessage message(boolean anonymous) {
        ChatMessage m = new ChatMessage();
        m.setId(1L);
        m.setLiveSessionId(UUID.randomUUID());
        m.setLessonId(UUID.randomUUID());
        m.setUserId(SENDER);
        m.setAnonymous(anonymous);
        m.setSenderName(anonymous ? "익명1" : "테스터");
        m.setSessionMs(1_000L);
        m.setText("안녕하세요");
        m.setCreatedAt(OffsetDateTime.now());
        return m;
    }

    @Test
    @DisplayName("익명 메시지는 지도에 URL이 있어도 사진을 싣지 않는다")
    void anonymous_message_never_carries_an_avatar() {
        var response = ChatMessageResponse.from(message(true), null, SENDER, Map.of(SENDER, AVATAR));

        assertThat(response.avatarUrl()).isNull();
        // 가명은 그대로 나간다 — 가리는 것은 신원이지 발언이 아니다.
        assertThat(response.alias()).isEqualTo("익명1");
    }

    @Test
    @DisplayName("익명이 아니면 사진이 실린다")
    void named_message_carries_the_avatar() {
        var response = ChatMessageResponse.from(message(false), null, SENDER, Map.of(SENDER, AVATAR));

        assertThat(response.avatarUrl()).isEqualTo(AVATAR);
    }

    /** 사진을 올리지 않은 사용자. 없는 것은 없는 대로 나가고, 화면은 이니셜로 채운다. */
    @Test
    @DisplayName("사진이 없으면 null이다")
    void missing_avatar_is_null() {
        var response = ChatMessageResponse.from(message(false), null, SENDER, Map.of());

        assertThat(response.avatarUrl()).isNull();
    }
}
