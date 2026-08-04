package com.liveclass.notification.push;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 푸시 발송용 <b>공유</b> HTTP 클라이언트.
 *
 * <p><b>왜 라이브러리의 발송을 쓰지 않는가.</b> `PushService.sendAsync`는 <b>호출 한 번마다</b>
 * `HttpAsyncClients.createSystem()`으로 클라이언트를 새로 만들고 시작한 뒤 응답 콜백에서 닫는다
 * (바이트코드 확인). 요청마다 연결 풀·I/O 리액터를 새로 세우고 TLS 핸드셰이크를 다시 하므로
 * 연결 재사용이 아예 없고, 순진하게 병렬화하면 <b>클라이언트 수만큼 셀렉터 스레드가 뜬다</b>.
 *
 *
 * <p><b>연결을 여러 개 연다.</b> JDK 클라이언트는 오리진당 연결을 <b>하나만</b> 유지하고 거기에
 * 다중화하는데, 연결 하나에 열 수 있는 동시 스트림 수는 서버가 정한다 — <b>실측으로 FCM·Mozilla
 * 모두 {@code MAX_CONCURRENT_STREAMS=100}을 광고한다</b>.
 *
 * <p><b>넘으면 줄을 서는 것이 아니라 터진다.</b> JDK는 스트림을 예약하지 못하면 그 자리에서
 * {@code IOException("too many concurrent streams")}를 던진다({@code Http2Connection.reserveStream}).
 * 10만 건 부하에서 실제로 1,700건 넘게 터진 뒤에야 알았다 — 2천 건 실행은 동시 피크가 상한에
 * 닿지 않아 이 상황에 도달하지 못한다.
 *
 * <p>그래서 두 가지를 지킨다.
 * <ol>
 *   <li><b>연결마다 몫을 따로 센다.</b> 전체 상한만 두고 순번으로 나눠 주면, 완료 시점이 달라
 *       한쪽에 쏠린 순간 그 연결이 자기 상한을 넘는다. 매번 <b>가장 한가한 연결</b>을 고른다.</li>
 *   <li><b>여유를 남긴다.</b> 광고값을 100% 쓰도록 계산하면 여유가 0이고, 서버는 SETTINGS를
 *       다시 보내 <b>상한을 도중에 낮출 수도</b> 있다.</li>
 * </ol>
 *
 * <p><b>HTTP/2는 선호일 뿐 전제가 아니다.</b> RFC 8030은 애플리케이션 서버 → 푸시 서비스 구간에
 * HTTP/1.1을 허용한다("Many of the exchanges can be completed using HTTP/1.1: … Requesting Push
 * Message Delivery"). 실측으로는 FCM·Mozilla·Apple 셋 다 ALPN에서 `h2`를 협상하지만, 브라우저가
 * 주는 엔드포인트는 우리가 고를 수 없다. JDK 클라이언트는 협상에 실패하면 <b>알아서 1.1로
 * 떨어지므로</b> 분기할 코드가 없다 — Apache 4.x(1.1 전용) 대신 이걸 쓰는 이유이기도 하다.
 */
public class WebPushHttpClient {

    private static final Logger log = LoggerFactory.getLogger(WebPushHttpClient.class);

    /** 실측값(2026-08-04). FCM·Mozilla가 연결 직후 SETTINGS로 광고하는 값이다. */
    public static final int OBSERVED_STREAMS_PER_CONNECTION = 100;

    /**
     * 광고값 중 실제로 쓸 비율. 나머지는 여유로 둔다.
     *
     * <p>100%로 계산하면 순간적인 쏠림이나 서버의 상한 하향에 바로 터진다 — 그리고 그 실패는
     * <b>재시도로 이어져 부하를 더 만든다</b>.
     */
    private static final double USABLE_STREAM_RATIO = 0.8;

    private final List<Connection> connections;
    private final Duration requestTimeout;

    /** 연결 하나와 그 연결이 지금 물고 있는 스트림 수. */
    private record Connection(HttpClient client, AtomicInteger inFlight) {
    }

    public WebPushHttpClient(Duration connectTimeout, Duration requestTimeout) {
        this(connectTimeout, requestTimeout, 1);
    }

    public WebPushHttpClient(Duration connectTimeout, Duration requestTimeout, int connections) {
        this.requestTimeout = requestTimeout;
        List<Connection> pool = new ArrayList<>(Math.max(1, connections));
        for (int i = 0; i < Math.max(1, connections); i++) {
            pool.add(new Connection(HttpClient.newBuilder()
                    /*
                     * h2를 **선호**한다. 상대가 못 하면 ALPN 협상에서 1.1로 내려간다.
                     * h2로 붙으면 이 클라이언트가 여는 연결 하나에 여러 요청이 겹친다.
                     */
                    .version(HttpClient.Version.HTTP_2)
                    .connectTimeout(connectTimeout)
                    .followRedirects(HttpClient.Redirect.NEVER)
                    .build(), new AtomicInteger()));
        }
        this.connections = List.copyOf(pool);
        log.info("웹 푸시 HTTP 연결 {}개 (연결당 스트림 실측 {}, 그중 {}%만 쓴다)",
                this.connections.size(), OBSERVED_STREAMS_PER_CONNECTION,
                Math.round(USABLE_STREAM_RATIO * 100));
    }

    /**
     * 동시 상한을 소화하는 데 필요한 연결 수.
     *
     * <p>올림으로 계산한다 — 100개를 넘기려면 두 번째 연결이 필요하고, 반올림하면 그 한 개가
     * 사라져 상한이 조용히 100으로 깎인다.
     */
    public static int connectionsFor(int maxInFlight, int streamsPerConnection) {
        int advertised = streamsPerConnection > 0
                ? streamsPerConnection : OBSERVED_STREAMS_PER_CONNECTION;
        int usable = Math.max(1, (int) (advertised * USABLE_STREAM_RATIO));
        return Math.max(1, (maxInFlight + usable - 1) / usable);
    }

    /**
     * 요청을 실을 연결. <b>가장 한가한 것</b>을 고른다.
     *
     * <p>순번으로 돌리면 <b>배정만</b> 고르고 <b>물고 있는 수</b>는 안 고르다 — 완료 시점이 제각각이라
     * 한쪽에 쌓이고, 그 연결이 자기 스트림 상한을 넘으면 그 요청들이 통째로 실패한다.
     */
    private Connection leastBusy() {
        Connection chosen = connections.get(0);
        for (Connection candidate : connections) {
            if (candidate.inFlight().get() < chosen.inFlight().get()) {
                chosen = candidate;
            }
        }
        return chosen;
    }

    int connectionCount() {
        return connections.size();
    }

    /**
     * 연결마다 지금 물고 있는 스트림 수. <b>테스트가 쏠림을 보는 창</b>이다.
     *
     * <p>서버 쪽 포트 수로는 확인할 수 없다 — 로컬 테스트 서버는 h2가 아니라 HTTP/1.1이고,
     * 그러면 JDK가 <b>동시 요청마다 연결을 따로 연다</b>. 우리 풀 크기와 무관한 숫자가 나온다.
     */
    public List<Integer> inFlightPerConnection() {
        return connections.stream().map(connection -> connection.inFlight().get()).toList();
    }

    /**
     * 라이브러리가 만든 요청을 그대로 실행한다.
     *
     * <p>본문은 이미 암호화돼 있고 헤더에 VAPID 서명·`Content-Encoding`·`TTL`이 들어 있다.
     * 우리가 하는 일은 <b>옮겨 담아 보내는 것</b>뿐이라, 여기서 헤더를 만들거나 고치지 않는다.
     *
     * <p>응답 본문은 버린다 — 푸시 서비스는 상태 코드로만 말한다. 다만 {@code Retry-After}는 읽는다.
     * 429는 "지금 말고 이따가"라는 뜻이고, 언제가 이따인지는 <b>상대가 정한다</b>.
     */
    public CompletableFuture<Response> send(WebPushRequest prepared) {
        HttpRequest.Builder builder = HttpRequest.newBuilder()
                .uri(prepared.endpoint())
                .timeout(requestTimeout)
                .POST(HttpRequest.BodyPublishers.ofByteArray(prepared.body()));
        prepared.headers().forEach((name, value) -> {
            /*
             * JDK 클라이언트는 Content-Length·Host 같은 헤더를 스스로 관리하며, 넣으려 하면
             * IllegalArgumentException을 던진다.
             */
            if (!RESTRICTED_HEADERS.contains(name.toLowerCase())) {
                builder.header(name, value);
            }
        });
        Connection connection = leastBusy();
        connection.inFlight().incrementAndGet();
        return connection.client()
                .sendAsync(builder.build(), HttpResponse.BodyHandlers.discarding())
                .whenComplete((ignored, ignoredError) -> connection.inFlight().decrementAndGet())
                .thenApply(response -> new Response(response.statusCode(), retryAfterOf(response)));
    }

    /**
     * 한 번의 응답. {@code retryAfter}는 상대가 알려 줬을 때만 있다.
     *
     * <p>{@code status < 0}은 응답을 못 받았다는 뜻이다(오류·타임아웃).
     */
    public record Response(int status, Duration retryAfter) {

        public static Response failed() {
            return new Response(-1, null);
        }
    }

    /**
     * {@code Retry-After}를 읽는다. RFC 9110이 <b>두 형식</b>을 허용한다 — 초, 또는 HTTP 날짜.
     * 푸시 서비스마다 다른 쪽을 쓰므로 둘 다 읽는다.
     *
     * <p>못 읽으면 {@code null}을 준다. 그러면 부르는 쪽이 자기 백오프를 쓴다 — 헤더 하나 때문에
     * 재시도 자체를 포기할 이유는 없다.
     */
    private static Duration retryAfterOf(HttpResponse<?> response) {
        String value = response.headers().firstValue("retry-after").orElse(null);
        if (value == null || value.isBlank()) {
            return null;
        }
        String trimmed = value.trim();
        try {
            return Duration.ofSeconds(Long.parseLong(trimmed));
        } catch (NumberFormatException notSeconds) {
            try {
                Duration until = Duration.between(java.time.Instant.now(),
                        java.time.format.DateTimeFormatter.RFC_1123_DATE_TIME
                                .parse(trimmed, java.time.OffsetDateTime::from).toInstant());
                // 이미 지난 시각이면 기다릴 것이 없다.
                return until.isNegative() ? Duration.ZERO : until;
            } catch (RuntimeException notDate) {
                log.debug("Retry-After를 읽지 못했습니다: {}", trimmed);
                return null;
            }
        }
    }

    /** JDK가 직접 관리하는 헤더. 우리가 실으면 요청 생성이 거부된다. */
    private static final java.util.Set<String> RESTRICTED_HEADERS =
            java.util.Set.of("content-length", "host", "connection", "upgrade", "expect");

    public void close() {
        // JDK 21의 HttpClient는 close()가 없다(가상 스레드 executor는 GC가 회수한다).
        log.debug("웹 푸시 HTTP 연결 {}개 종료 요청 — JDK 클라이언트는 명시적 해제가 없다",
                connections.size());
    }
}
