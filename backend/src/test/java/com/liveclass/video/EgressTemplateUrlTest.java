package com.liveclass.video;

import com.liveclass.video.service.LiveKitEgressControl;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 합성 템플릿 주소 조립.
 *
 * <p>LiveKit은 이 값 뒤에 {@code ?url=&token=}을 붙여 그대로 연다. 오리진만 넣어 경로가 빠지면
 * Egress가 앱 첫 화면을 열고, 거기엔 {@code START_RECORDING}이 없어 "Start signal not received"로
 * 녹화가 통째로 죽는다. 백엔드는 시작 요청이 성공했다고 보므로 원인이 드러나지 않는다.
 * 실제로 운영에서 한 번 겪었다 — 그래서 경로를 코드가 책임진다.
 */
class EgressTemplateUrlTest {

    @ParameterizedTest
    @ValueSource(strings = {
            "https://jiphyeonjeon.thdwjdrl.com",
            "https://jiphyeonjeon.thdwjdrl.com/",
            "https://jiphyeonjeon.thdwjdrl.com///",
    })
    @DisplayName("오리진만 주면 템플릿 경로를 붙인다")
    void appendsPathToOrigin(String configured) {
        assertThat(LiveKitEgressControl.templateUrl(configured))
                .isEqualTo("https://jiphyeonjeon.thdwjdrl.com/egress/stage");
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "https://jiphyeonjeon.thdwjdrl.com/egress/stage",
            "https://jiphyeonjeon.thdwjdrl.com/egress/stage/",
            "  https://jiphyeonjeon.thdwjdrl.com/egress/stage  ",
    })
    @DisplayName("경로가 이미 있으면 두 번 붙이지 않는다")
    void keepsFullPageUrl(String configured) {
        assertThat(LiveKitEgressControl.templateUrl(configured))
                .isEqualTo("https://jiphyeonjeon.thdwjdrl.com/egress/stage");
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "   "})
    @DisplayName("비우면 빈 값 — LiveKit 기본 템플릿으로 돈다")
    void blankFallsBackToDefaultTemplate(String configured) {
        assertThat(LiveKitEgressControl.templateUrl(configured)).isEmpty();
    }

    @Test
    @DisplayName("null도 빈 값으로 다룬다")
    void nullFallsBackToDefaultTemplate() {
        assertThat(LiveKitEgressControl.templateUrl(null)).isEmpty();
    }

    @Test
    @DisplayName("포트가 있는 개발 주소도 그대로 다룬다")
    void supportsHostWithPort() {
        assertThat(LiveKitEgressControl.templateUrl("http://172.17.0.1:8083"))
                .isEqualTo("http://172.17.0.1:8083/egress/stage");
    }
}
