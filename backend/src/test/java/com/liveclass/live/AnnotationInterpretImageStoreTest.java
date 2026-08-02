package com.liveclass.live;

import com.liveclass.live.service.AnnotationInterpretImageStore;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 판서 해석 이미지 임시 보관(ADR-0058).
 *
 * <p>이 저장소는 <b>공개 경로로 노출된다</b> — 받아가는 쪽이 모델 제공자의 서버라 우리 인증 주체가
 * 아니기 때문이다. 그래서 여기서 고정하는 것은 기능이 아니라 <b>노출 창</b>이다.
 */
class AnnotationInterpretImageStoreTest {

    private final AnnotationInterpretImageStore store = new AnnotationInterpretImageStore();

    private static byte[] png() {
        return "fake-png".getBytes(StandardCharsets.UTF_8);
    }

    @Test
    void 등록한_이미지를_토큰으로_찾는다() {
        String token = store.publish(png(), "image/png");

        assertThat(store.find(token)).isPresent();
        assertThat(store.find(token).orElseThrow().mediaType()).isEqualTo("image/png");
    }

    /** <b>호출이 끝나면 사라진다.</b> 강의 내용이므로 필요한 시간 이상 열어 둘 이유가 없다. */
    @Test
    void 폐기하면_더는_찾을_수_없다() {
        String token = store.publish(png(), "image/png");
        store.discard(token);

        assertThat(store.find(token)).isEmpty();
    }

    /** 없는 토큰으로는 아무것도 나오지 않는다 — 404로 이어진다. */
    @Test
    void 모르는_토큰은_비어_있다() {
        assertThat(store.find("존재하지-않는-토큰")).isEmpty();
    }

    /**
     * <b>토큰은 추측할 수 없어야 한다.</b> 이것이 유일한 자격이므로, 짧거나 순차적이면 그대로
     * 판서가 새어 나간다.
     */
    @Test
    void 토큰은_매번_다르고_충분히_길다() {
        Set<String> tokens = new HashSet<>();
        for (int i = 0; i < 200; i += 1) {
            String token = store.publish(png(), "image/png");
            tokens.add(token);
            store.discard(token);
        }

        assertThat(tokens).hasSize(200);
        // 128비트를 base64url로 담으면 22자다. 그보다 짧으면 난수 폭이 줄었다는 뜻이다.
        assertThat(tokens).allSatisfy(token -> assertThat(token).hasSizeGreaterThanOrEqualTo(22));
    }
}
