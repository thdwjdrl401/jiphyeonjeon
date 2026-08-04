package com.liveclass.notification.push;

import org.apache.http.Header;
import org.apache.http.client.methods.HttpPost;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
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
 * <p>그래서 라이브러리는 <b>암호화기로만</b> 쓴다 — `preparePost`가 RFC 8291 암호화와 RFC 8292
 * VAPID 서명을 끝낸 요청을 돌려주므로, 그것을 JDK 클라이언트가 이해하는 형태로 옮겨 <b>하나의
 * 클라이언트</b>로 실행한다.
 *
 * <p><b>연결을 여러 개 연다.</b> JDK 클라이언트는 오리진당 연결을 <b>하나만</b> 유지하고 거기에
 * 다중화하는데, 연결 하나에 열 수 있는 동시 스트림 수는 서버가 정한다 — <b>실측으로 FCM·Mozilla
 * 모두 {@code MAX_CONCURRENT_STREAMS=100}을 광고한다</b>. 그래서 클라이언트가 하나면 동시 요청이
 * 100에서 막히고, 그 이상은 JDK 내부 큐에서 줄을 선다(상한을 올려도 펜딩 객체만 쌓인다).
 *
 * <p>연결을 더 열려면 <b>클라이언트 인스턴스를 더 만드는 수밖에 없다</b>. 그래서 여기서 풀을 든다.
 * 개수는 짐작하지 않고 {@code 동시 상한 ÷ 연결당 스트림}으로 <b>정한다</b> — 그래야 동시 상한을
 * 올렸을 때 연결이 따라 늘고, 숫자 두 개가 서로 어긋나지 않는다.
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

    private final List<HttpClient> clients;
    private final AtomicInteger next = new AtomicInteger();
    private final Duration requestTimeout;

    public WebPushHttpClient(Duration connectTimeout, Duration requestTimeout) {
        this(connectTimeout, requestTimeout, 1);
    }

    public WebPushHttpClient(Duration connectTimeout, Duration requestTimeout, int connections) {
        this.requestTimeout = requestTimeout;
        List<HttpClient> pool = new ArrayList<>(Math.max(1, connections));
        for (int i = 0; i < Math.max(1, connections); i++) {
            pool.add(HttpClient.newBuilder()
                    /*
                     * h2를 **선호**한다. 상대가 못 하면 ALPN 협상에서 1.1로 내려간다.
                     * h2로 붙으면 이 클라이언트가 여는 연결 하나에 여러 요청이 겹친다.
                     */
                    .version(HttpClient.Version.HTTP_2)
                    .connectTimeout(connectTimeout)
                    .followRedirects(HttpClient.Redirect.NEVER)
                    .build());
        }
        this.clients = List.copyOf(pool);
        log.info("웹 푸시 HTTP 클라이언트 {}개 (연결당 스트림 상한 실측 {})",
                this.clients.size(), OBSERVED_STREAMS_PER_CONNECTION);
    }

    /**
     * 동시 상한을 소화하는 데 필요한 연결 수.
     *
     * <p>올림으로 계산한다 — 100개를 넘기려면 두 번째 연결이 필요하고, 반올림하면 그 한 개가
     * 사라져 상한이 조용히 100으로 깎인다.
     */
    public static int connectionsFor(int maxInFlight, int streamsPerConnection) {
        int streams = streamsPerConnection > 0 ? streamsPerConnection : OBSERVED_STREAMS_PER_CONNECTION;
        return Math.max(1, (maxInFlight + streams - 1) / streams);
    }

    /**
     * 다음 요청을 실을 연결. <b>돌아가며</b> 고른다.
     *
     * <p>구독 id로 해싱하지 않는 이유는, 어느 기기가 어느 연결로 가든 상관없고 <b>고르게 퍼지는
     * 것만</b> 중요하기 때문이다. 해시는 치우칠 수 있지만 순번은 그럴 수 없다.
     */
    private HttpClient nextClient() {
        return clients.get(Math.floorMod(next.getAndIncrement(), clients.size()));
    }

    int connectionCount() {
        return clients.size();
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
    public CompletableFuture<Response> send(HttpPost prepared) {
        HttpRequest.Builder builder = HttpRequest.newBuilder()
                .uri(URI.create(prepared.getURI().toString()))
                .timeout(requestTimeout)
                .POST(bodyOf(prepared));
        for (Header header : prepared.getAllHeaders()) {
            /*
             * JDK 클라이언트는 Content-Length·Host 같은 헤더를 스스로 관리하며, 넣으려 하면
             * IllegalArgumentException을 던진다. 라이브러리가 붙인 값을 그대로 흘리면 터진다.
             */
            if (RESTRICTED_HEADERS.contains(header.getName().toLowerCase())) {
                continue;
            }
            builder.header(header.getName(), header.getValue());
        }
        return nextClient().sendAsync(builder.build(), HttpResponse.BodyHandlers.discarding())
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

    private static HttpRequest.BodyPublisher bodyOf(HttpPost prepared) {
        if (prepared.getEntity() == null) {
            return HttpRequest.BodyPublishers.noBody();
        }
        try (InputStream in = prepared.getEntity().getContent()) {
            return HttpRequest.BodyPublishers.ofByteArray(in.readAllBytes());
        } catch (IOException e) {
            // 암호화된 본문을 읽지 못하는 건 우리 쪽 문제다. 보낼 것이 없으니 빈 본문으로 두지 않는다.
            throw new IllegalStateException("푸시 본문을 읽지 못했습니다.", e);
        }
    }

    public void close() {
        // JDK 21의 HttpClient는 close()가 없다(가상 스레드 executor는 GC가 회수한다).
        log.debug("웹 푸시 HTTP 클라이언트 {}개 종료 요청 — JDK 클라이언트는 명시적 해제가 없다",
                clients.size());
    }
}
