package com.liveclass.live;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.AppenderBase;
import com.liveclass.live.config.CaptionStreamConsumer;
import com.liveclass.live.config.CaptionStreamProperties;
import com.liveclass.live.repository.LiveCaptionRepository;
import com.liveclass.live.service.CaptionEventParser;
import com.liveclass.live.service.CaptionStreamListener;
import com.liveclass.live.service.LiveCaptionService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceClientConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.BooleanSupplier;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 자막 consumer 복원력 회귀 테스트(ADR-0043 복원력 보강). 실측 장애를 재현한다 —
 * 일시적 Redis 연결 끊김 하나로 소비가 <b>영구 정지</b>하고 네트워크가 복구돼도 재개되지 않던 버그.
 *
 * <p>재현 방법: Testcontainers Redis 앞에 in-JVM TCP 프록시를 세우고 consumer만 그 프록시를 통해
 * 연결한다(다른 테스트가 공유하는 싱글턴 Redis 컨테이너는 건드리지 않는다 — pause/stop을 쓰면
 * 스위트 전체가 흔들린다). 프록시를 닫아 "네트워크 불가"를 만들고, 다시 열어 복구시킨다.
 *
 * <p>고정하는 계약:
 * <ol>
 *   <li>끊김 동안 오류를 <b>삼키지 않고</b> ERROR로 남긴다(장애가 보여야 한다).</li>
 *   <li>연결이 복구되면 <b>재기동 없이</b> 새 엔트리를 다시 소비하고 ACK한다(pending 0으로 수렴).</li>
 * </ol>
 * consumer는 자체 인스턴스로 격리 stream-key/group에 붙인다(컨텍스트 기본은 off — 교차 오염 방지).
 */
@SpringBootTest
class LiveCaptionStreamResilienceTest {

    private static final String STREAM_KEY = "ai:captions:test:resilience";
    private static final String GROUP = "spring-caption-test-resilience";
    private static final UUID SESSION_ID = UUID.fromString("33333333-3333-4333-8333-333333333333");
    private static final UUID LESSON_ID = UUID.fromString("44444444-4444-4444-8444-444444444444");
    private static final Duration TIMEOUT = Duration.ofSeconds(30);

    @Autowired
    private RedisConnectionFactory appConnectionFactory;

    /** 컨테이너 Redis에 직접 붙는 템플릿 — XADD·pending 조회·listener의 ACK에 쓴다(프록시 밖). */
    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private CaptionEventParser parser;

    @Autowired
    private LiveCaptionService captionService;

    @Autowired
    private LiveCaptionRepository repository;

    @Autowired
    private JdbcTemplate jdbc;

    /**
     * 이 세션의 잔여 행을 앞뒤로 지운다. Redis 키는 이미 지우고 있었지만({@code redis.delete}) <b>PG는
     * 그대로 뒀다.</b> 그래서 DB가 재사용되면 이전 실행이 남긴 2행 때문에 {@code countBySessionId == 2}가
     * 소비자를 한 번도 안 태우고 통과한다 — 끊김 뒤 재소비라는 이 테스트의 본론이 조용히 사라진다.
     */
    @BeforeEach
    @AfterEach
    void clearFixtureRows() {
        jdbc.update("DELETE FROM core.live_caption WHERE session_id = ?", SESSION_ID);
    }

    @Test
    void consumption_resumes_after_transient_connection_failure() throws Exception {
        LettuceConnectionFactory direct = (LettuceConnectionFactory) appConnectionFactory;
        CaptionStreamProperties properties = new CaptionStreamProperties(
                true, STREAM_KEY, GROUP, null, "resilience-1", 100, Duration.ofMillis(200));
        CaptionStreamListener listener = new CaptionStreamListener(parser, captionService, redis, properties);

        CapturingAppender logs = attachAppender();
        redis.delete(STREAM_KEY);   // 이전 실행 잔여 제거(그룹·pending 포함)

        try (TcpProxy proxy = new TcpProxy(direct.getHostName(), direct.getPort())) {
            LettuceConnectionFactory viaProxy = proxiedConnectionFactory(proxy.localPort());
            viaProxy.afterPropertiesSet();
            CaptionStreamConsumer consumer =
                    new CaptionStreamConsumer(viaProxy, new StringRedisTemplate(viaProxy), listener, properties);
            consumer.start();
            try {
                // 1) 정상 경로: 프록시를 통해 소비된다.
                redis.opsForStream().add(STREAM_KEY, delta("resilience-before", 1));
                await(() -> repository.existsByEventId("resilience-before"));

                // 2) 네트워크 끊김: 리스닝 소켓과 열린 연결을 모두 끊는다 → 매 poll이 connect 실패.
                proxy.disconnect();
                await(() -> logs.events.stream().anyMatch(event -> event.getLevel() == Level.ERROR));

                // 3) 복구: Lettuce가 다시 붙을 수 있게 프록시를 되살린다. 재기동은 하지 않는다.
                proxy.reconnect();

                // 4) 핵심 회귀: 복구 후 새 엔트리가 소비된다(버그 상태에서는 구독이 취소돼 영원히 안 읽힘).
                redis.opsForStream().add(STREAM_KEY, delta("resilience-after", 2));
                await(() -> repository.existsByEventId("resilience-after"));
                // ACK도 계속 동작한다 → pending 0으로 수렴.
                await(() -> pending() == 0L);

                assertThat(repository.countBySessionId(SESSION_ID)).isEqualTo(2L);
                // 장애는 조용히 삼켜지지 않았다 — ERROR로 최소 1건 남아 있다.
                assertThat(logs.events).anySatisfy(event -> {
                    assertThat(event.getLevel()).isEqualTo(Level.ERROR);
                    assertThat(event.getFormattedMessage()).contains("자막 consumer");
                });
            } finally {
                consumer.stop();
                viaProxy.destroy();
            }
        } finally {
            detachAppender(logs);
            redis.delete(STREAM_KEY);
        }
    }

    /**
     * 프록시를 향하는 consumer 전용 커넥션 팩토리. {@code commandTimeout}을 짧게 준다 — Lettuce 기본값은
     * 60초이고, 연결이 끊기면 <b>이미 나간 XREADGROUP이 재연결을 기다리며 그만큼 매달린다</b>. 테스트를
     * 분 단위로 늘리지 않으려고 줄인 것이며, 오류가 발생하는 경로 자체는 운영과 같다.
     */
    private static LettuceConnectionFactory proxiedConnectionFactory(int port) {
        return new LettuceConnectionFactory(
                new RedisStandaloneConfiguration("127.0.0.1", port),
                LettuceClientConfiguration.builder().commandTimeout(Duration.ofSeconds(2)).build());
    }

    private long pending() {
        var summary = redis.opsForStream().pending(STREAM_KEY, GROUP);
        return summary == null ? 0L : summary.getTotalPendingMessages();
    }

    private Map<String, String> delta(String eventId, long sequence) {
        Map<String, String> fields = new LinkedHashMap<>();
        fields.put("contractVersion", "1");
        fields.put("type", "caption.delta");
        fields.put("eventId", eventId);
        fields.put("sessionId", SESSION_ID.toString());
        fields.put("lessonId", LESSON_ID.toString());
        fields.put("sttSessionId", "openai-realtime:resilience");
        fields.put("sequence", Long.toString(sequence));
        fields.put("streamElapsedMs", Long.toString(1000 * sequence));
        fields.put("text", "복원력 " + sequence);
        fields.put("occurredAt", "2026-07-29T12:00:0" + sequence + ".000Z");
        return fields;
    }

    private static CapturingAppender attachAppender() {
        CapturingAppender appender = new CapturingAppender();
        appender.start();
        consumerLogger().addAppender(appender);
        return appender;
    }

    private static void detachAppender(CapturingAppender appender) {
        consumerLogger().detachAppender(appender);
        appender.stop();
    }

    /**
     * poll 스레드가 append하고 테스트 스레드가 읽으므로 {@code ListAppender}(비동기 안전하지 않은
     * ArrayList) 대신 복사-쓰기 리스트로 모은다.
     */
    private static final class CapturingAppender extends AppenderBase<ILoggingEvent> {

        private final List<ILoggingEvent> events = new CopyOnWriteArrayList<>();

        @Override
        protected void append(ILoggingEvent event) {
            events.add(event);
        }
    }

    private static ch.qos.logback.classic.Logger consumerLogger() {
        return (ch.qos.logback.classic.Logger) LoggerFactory.getLogger(CaptionStreamConsumer.class);
    }

    private static void await(BooleanSupplier condition) throws InterruptedException {
        Instant deadline = Instant.now().plus(TIMEOUT);
        while (Instant.now().isBefore(deadline)) {
            if (condition.getAsBoolean()) {
                return;
            }
            Thread.sleep(100);
        }
        throw new AssertionError("조건이 시간 내에 충족되지 않았습니다.");
    }

    /**
     * Redis 앞단 TCP 프록시. {@link #disconnect()}는 리스닝 소켓을 닫고 열린 연결을 모두 끊어
     * "Network is unreachable"과 같은 상태(connect 즉시 실패)를 만든다. {@link #reconnect()}는
     * <b>같은 포트</b>로 다시 리스닝해 네트워크 복구를 재현한다 — consumer 설정을 바꾸지 않고
     * 끊김/복구만 재현하기 위함이다.
     */
    private static final class TcpProxy implements Closeable {

        private final String targetHost;
        private final int targetPort;
        private final int localPort;
        private final List<Closeable> openSockets = Collections.synchronizedList(new ArrayList<>());
        private final ExecutorService pool = Executors.newCachedThreadPool(runnable -> {
            Thread thread = new Thread(runnable, "caption-redis-proxy");
            thread.setDaemon(true);
            return thread;
        });
        private volatile ServerSocket server;

        TcpProxy(String targetHost, int targetPort) throws IOException {
            this.targetHost = targetHost;
            this.targetPort = targetPort;
            ServerSocket socket = bind(0);
            this.localPort = socket.getLocalPort();
            accept(socket);
        }

        int localPort() {
            return localPort;
        }

        void disconnect() {
            closeQuietly(server);
            server = null;
            synchronized (openSockets) {
                openSockets.forEach(TcpProxy::closeQuietly);
                openSockets.clear();
            }
        }

        void reconnect() throws IOException {
            accept(bind(localPort));
        }

        @Override
        public void close() {
            disconnect();
            pool.shutdownNow();
        }

        private static ServerSocket bind(int port) throws IOException {
            ServerSocket socket = new ServerSocket();
            socket.setReuseAddress(true);
            socket.bind(new InetSocketAddress("127.0.0.1", port));
            return socket;
        }

        private void accept(ServerSocket socket) {
            this.server = socket;
            pool.execute(() -> {
                while (!socket.isClosed()) {
                    Socket client;
                    try {
                        client = socket.accept();
                    } catch (IOException closed) {
                        return;   // disconnect()/close()로 리스닝 소켓이 닫혔다
                    }
                    try {
                        Socket upstream = new Socket(targetHost, targetPort);
                        openSockets.add(client);
                        openSockets.add(upstream);
                        pump(client, upstream);
                        pump(upstream, client);
                    } catch (IOException upstreamFailed) {
                        closeQuietly(client);
                    }
                }
            });
        }

        private void pump(Socket from, Socket to) {
            pool.execute(() -> {
                byte[] buffer = new byte[8192];
                try (Socket in = from; Socket out = to) {
                    InputStream source = in.getInputStream();
                    OutputStream sink = out.getOutputStream();
                    int read;
                    while ((read = source.read(buffer)) != -1) {
                        sink.write(buffer, 0, read);
                        sink.flush();
                    }
                } catch (IOException broken) {
                    // 끊김은 이 테스트가 의도한 상태다 — 양쪽 소켓은 try-with-resources가 닫는다.
                }
            });
        }

        private static void closeQuietly(Closeable closeable) {
            if (closeable == null) {
                return;
            }
            try {
                closeable.close();
            } catch (IOException ignored) {
                // 정리 경로 — 무시
            }
        }
    }
}
