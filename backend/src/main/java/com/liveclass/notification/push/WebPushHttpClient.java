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
import java.util.concurrent.CompletableFuture;

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
 * <p><b>HTTP/2는 선호일 뿐 전제가 아니다.</b> RFC 8030은 애플리케이션 서버 → 푸시 서비스 구간에
 * HTTP/1.1을 허용한다("Many of the exchanges can be completed using HTTP/1.1: … Requesting Push
 * Message Delivery"). 실측으로는 FCM·Mozilla·Apple 셋 다 ALPN에서 `h2`를 협상하지만, 브라우저가
 * 주는 엔드포인트는 우리가 고를 수 없다. JDK 클라이언트는 협상에 실패하면 <b>알아서 1.1로
 * 떨어지므로</b> 분기할 코드가 없다 — Apache 4.x(1.1 전용) 대신 이걸 쓰는 이유이기도 하다.
 */
public class WebPushHttpClient {

    private static final Logger log = LoggerFactory.getLogger(WebPushHttpClient.class);

    private final HttpClient client;
    private final Duration requestTimeout;

    public WebPushHttpClient(Duration connectTimeout, Duration requestTimeout) {
        this.requestTimeout = requestTimeout;
        this.client = HttpClient.newBuilder()
                /*
                 * h2를 **선호**한다. 상대가 못 하면 ALPN 협상에서 1.1로 내려간다.
                 * h2로 붙으면 같은 호스트(대부분 fcm.googleapis.com)로 가는 요청이 연결 하나를
                 * 다중화하므로, 동시성이 연결 수에 묶이지 않는다.
                 */
                .version(HttpClient.Version.HTTP_2)
                .connectTimeout(connectTimeout)
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
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
        return client.sendAsync(builder.build(), HttpResponse.BodyHandlers.discarding())
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
        log.debug("웹 푸시 HTTP 클라이언트 종료 요청 — JDK 클라이언트는 명시적 해제가 없다");
    }
}
