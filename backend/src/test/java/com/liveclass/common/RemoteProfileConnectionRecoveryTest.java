package com.liveclass.common;

import org.junit.jupiter.api.Test;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.PropertySource;
import org.springframework.core.io.ClassPathResource;

import java.io.IOException;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * remote 프로필의 커넥션 회복 설정.
 *
 * <p><b>왜 이 테스트가 있나.</b> remote 프로필은 <b>JVM만 로컬</b>이고 데이터 평면(PG·Redis·RabbitMQ)은
 * 전부 EC2에 있다. 노트북 네트워크가 바뀌면 그 연결이 한꺼번에 죽는데, Lettuce는 Hikari와 달리
 * 꺼낼 때 검증하는 장치가 없어 죽은 소켓으로 명령을 보내고 기본 타임아웃까지 매달린다.
 *
 * <p>실측(2026-07-31): 그 상태에서 {@code GET /api/auth/me}가 <b>20초 넘게 무응답</b>이었다. 세션이
 * Redis에 있어 로그인·화면 진입이 통째로 막혔고, {@code /actuator/health}는 그동안 UP을 반환해
 * 문제를 가렸다. 같은 시점에 Redis 서버 자체는 멀쩡했다(호스트에서 {@code PING} → {@code PONG}).
 *
 * <p>설정은 YAML 한 줄이라 <b>틀려도 아무 신호가 없다</b> — 들여쓰기가 한 칸 어긋나면 Spring이
 * 조용히 무시하고 기본값으로 돌아간다. 그러면 다음에 같은 20초 멈춤을 다시 겪고서야 안다. 그래서
 * 키가 올바른 자리에 있는지를 고정한다.
 */
class RemoteProfileConnectionRecoveryTest {

    private static final Pattern PLACEHOLDER = Pattern.compile("\\$\\{[^:}]+:([^}]*)}");

    private static PropertySource<?> load(String file) throws IOException {
        List<PropertySource<?>> sources =
                new YamlPropertySourceLoader().load(file, new ClassPathResource(file));
        assertThat(sources).as(file + " 를 읽지 못했다").isNotEmpty();
        return sources.getFirst();
    }

    /** {@code ${VAR:3s}} 형태에서 기본값만 뽑는다. 배포 때 env로 덮더라도 이 값이 바닥이다. */
    private static String defaultOf(Object raw) {
        assertThat(raw).as("설정 키가 없다 — 들여쓰기가 어긋났을 수 있다").isNotNull();
        Matcher matcher = PLACEHOLDER.matcher(String.valueOf(raw));
        return matcher.matches() ? matcher.group(1) : String.valueOf(raw);
    }

    /**
     * Lettuce가 죽은 소켓에 매달리지 않게 한다. 20초 멈춤보다 3초 실패가 낫다 — 실패하면 다음
     * 요청에서 다시 맺지만, 매달리면 강사가 아무것도 할 수 없다.
     */
    @Test
    void remote_프로필은_Redis_타임아웃을_짧게_잡는다() throws IOException {
        PropertySource<?> remote = load("application-remote.yml");

        assertThat(defaultOf(remote.getProperty("spring.data.redis.timeout"))).isEqualTo("3s");
        assertThat(defaultOf(remote.getProperty("spring.data.redis.connect-timeout"))).isEqualTo("3s");
    }

    /**
     * Hikari는 꺼낼 때 검증해 스스로 회복하지만, 그 비용을 <b>첫 요청 몇 개</b>가 치른다.
     * keepalive로 유휴 연결을 미리 찔러 두면 그 비용이 백그라운드로 간다.
     *
     * <p><b>값이 밀리초 숫자인지까지 본다.</b> 이 블록은 Spring의 Duration 변환을 거치지 않고
     * {@code HikariConfig}의 {@code long} 필드에 그대로 바인딩되므로, {@code "30s"} 같은 문자열을
     * 쓰면 <b>애플리케이션이 기동조차 하지 못한다</b>:
     *
     * <pre>
     * Failed to bind properties under 'spring.datasource.hikari.keepalive-time' to long:
     *     Value: "${REMOTE_DB_KEEPALIVE:30s}"
     *     Reason: For input string: "30s"
     * </pre>
     *
     * <p>실제로 그렇게 적어 두어 remote 프로필이 한동안 뜨지 못했다. 이전 버전의 이 테스트는 그
     * 문자열을 <b>기대값으로 고정하고 있어</b> 오히려 버그를 지키고 있었다 — 그래서 여기서 고정할
     * 것은 특정 문자열이 아니라 <b>단위</b>다.
     */
    @Test
    void remote_프로필은_커넥션_풀을_주기적으로_검증한다() throws IOException {
        PropertySource<?> remote = load("application-remote.yml");

        // 의도한 값: 30초 / 5분 / 3초. Hikari는 밀리초 long만 받는다.
        assertThat(millisOf(remote, "spring.datasource.hikari.keepalive-time")).isEqualTo(30_000L);
        assertThat(millisOf(remote, "spring.datasource.hikari.max-lifetime")).isEqualTo(300_000L);
        assertThat(millisOf(remote, "spring.datasource.hikari.validation-timeout")).isEqualTo(3_000L);
    }

    /**
     * Hikari 설정값을 밀리초 {@code long}으로 읽는다. 숫자가 아니면 여기서 실패한다 — 기동 때
     * 터지는 것을 테스트 시점으로 당기는 것이 이 메서드의 전부다.
     */
    private static long millisOf(PropertySource<?> source, String key) {
        String raw = defaultOf(source.getProperty(key));
        try {
            return Long.parseLong(raw);
        } catch (NumberFormatException e) {
            throw new AssertionError(
                    "%s 는 밀리초 숫자여야 한다(HikariConfig의 long 필드에 그대로 바인딩된다). 실제: \"%s\""
                            .formatted(key, raw), e);
        }
    }

    /**
     * <b>이 테스트가 이 파일의 핵심이다.</b> 위 값들이 기본 설정으로 새어 나가면 prod까지 바뀐다.
     *
     * <p>prod는 같은 도커 네트워크 안이라 이런 끊김이 없고, 거기서 타임아웃을 줄이면 정상 부하에서
     * 오히려 실패가 는다 — 느린 쿼리 하나가 3초를 넘기면 그때부터 사용자 오류가 된다. 개발 편의를
     * 위한 설정이 운영 안정성을 깎는 일이 없어야 한다.
     */
    @Test
    void 기본_프로필은_건드리지_않는다() throws IOException {
        PropertySource<?> base = load("application.yml");

        assertThat(base.getProperty("spring.data.redis.timeout")).isNull();
        assertThat(base.getProperty("spring.data.redis.connect-timeout")).isNull();
        assertThat(base.getProperty("spring.datasource.hikari.keepalive-time")).isNull();
        assertThat(base.getProperty("spring.datasource.hikari.max-lifetime")).isNull();
    }
}
