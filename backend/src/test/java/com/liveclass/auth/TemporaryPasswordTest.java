package com.liveclass.auth;

import com.liveclass.auth.service.TemporaryPassword;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 임시 비밀번호가 지켜야 할 것.
 *
 * <p>지금 정책은 "8자 이상, UTF-8 72바이트 이하"뿐이라 통과는 쉽다. 여기서 고정하려는 것은 그
 * 최소선이 아니라 <b>사람이 옮겨 적을 수 있는가</b>와 <b>같은 값이 두 번 나오지 않는가</b>다.
 */
class TemporaryPasswordTest {

    private static final int SAMPLES = 500;

    @Test
    void 비밀번호_정책의_두_끝을_지킨다() {
        for (int i = 0; i < SAMPLES; i++) {
            String password = TemporaryPassword.generate();
            assertThat(password.length()).isGreaterThanOrEqualTo(8);
            // bcrypt는 72바이트를 넘으면 조용히 잘라 낸다 — 정책의 상한도 거기서 온다.
            assertThat(password.getBytes(StandardCharsets.UTF_8).length).isLessThanOrEqualTo(72);
        }
    }

    @Test
    void 헷갈리는_글자를_쓰지_않는다() {
        /*
         * 메일에서 복사해 붙이는 것이 보통이지만, 휴대폰으로 보고 노트북에 치는 일도 흔하다.
         * 0/O/o·1/l/I가 섞이면 그 자리에서 오타가 난다.
         */
        for (int i = 0; i < SAMPLES; i++) {
            assertThat(TemporaryPassword.generate()).doesNotContainAnyWhitespaces()
                    .doesNotContain("0", "O", "o", "1", "l", "I");
        }
    }

    @Test
    void 대문자_소문자_숫자를_모두_담는다() {
        /*
         * 지금 정책은 복잡도를 요구하지 않는다. 그래도 채워 두는 이유는, 사용자가 이 값을 그대로
         * 쓰다가 나중에 정책이 강해지면 재발급부터 막히기 때문이다.
         */
        for (int i = 0; i < SAMPLES; i++) {
            String password = TemporaryPassword.generate();
            assertThat(password).matches(".*[A-Z].*").matches(".*[a-z].*").matches(".*[0-9].*");
        }
    }

    @Test
    void 자리마다_같은_종류가_고정되지_않는다() {
        /*
         * 채운 뒤 섞지 않으면 "첫 글자는 늘 대문자"가 되어 추측 범위를 좁힌다. 첫 자리에 세 종류가
         * 모두 나타나는지로 확인한다.
         */
        Set<String> kindsAtFirstPosition = new HashSet<>();
        for (int i = 0; i < SAMPLES; i++) {
            char first = TemporaryPassword.generate().charAt(0);
            kindsAtFirstPosition.add(Character.isDigit(first) ? "digit"
                    : Character.isUpperCase(first) ? "upper" : "lower");
        }
        assertThat(kindsAtFirstPosition).containsExactlyInAnyOrder("digit", "upper", "lower");
    }

    @Test
    void 같은_값이_반복되지_않는다() {
        Set<String> generated = IntStream.range(0, SAMPLES)
                .mapToObj(i -> TemporaryPassword.generate())
                .collect(HashSet::new, Set::add, Set::addAll);
        assertThat(generated).hasSize(SAMPLES);
    }
}
