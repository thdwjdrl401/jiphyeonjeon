package com.liveclass.live.config;

import com.liveclass.live.service.CaptionStreamListener;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.SmartLifecycle;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.connection.stream.Consumer;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.connection.stream.ReadOffset;
import org.springframework.data.redis.connection.stream.StreamOffset;
import org.springframework.data.redis.connection.stream.StreamReadOptions;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.serializer.StringRedisSerializer;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.data.redis.stream.StreamMessageListenerContainer;
import org.springframework.data.redis.stream.StreamMessageListenerContainer.StreamMessageListenerContainerOptions;
import org.springframework.data.redis.stream.StreamMessageListenerContainer.StreamReadRequest;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;

/**
 * 라이브 자막 Redis Stream consumer 배선(ADR-0043, CONTRACT §3-4). 기존 자동설정
 * {@link RedisConnectionFactory}(=프로필 구동 {@code spring.data.redis} Redis)를 재사용해
 * {@link StreamMessageListenerContainer}(Lettuce)로 소비한다.
 *
 * <p>{@link SmartLifecycle}로 컨테이너 수명을 직접 통제한다. 컨테이너를 시작하기 전에 group을
 * 만들고(BUSYGROUP 무시, {@code MKSTREAM}) 재기동 시 자기 consumer의 pending을 drain해야 하기 때문이다.
 * 등록은 {@link StreamReadRequest}를 직접 만들어 한다({@code receive(...)} 대신), 수동 ACK
 * ({@code autoAcknowledge(false)}, {@link CaptionStreamListener}가 엔트리별 XACK)와 함께
 * {@code cancelOnError(t -> false)}를 걸어야 하기 때문이다.
 *
 * <p>왜 cancelOnError가 필요한가(복원력): Spring Data Redis의 기본 정책은
 * {@code StreamReadRequestBuilder.cancelSubscriptionOnError = t -> true}이고
 * {@code StreamPollTask.doLoop()}는 poll 예외마다 이 술어를 먼저 평가해 참이면 구독을 {@code cancel()}
 * 하고 그 다음에 errorHandler를 호출한다. 즉 errorHandler를 줘도 로깅만 하고 구독은 이미 취소된다.
 * 그래서 네트워크가 한 번 끊겨 {@code RedisConnectionFailureException} 하나만 나도 poll 루프가 끝나고,
 * 네트워크가 복구돼도(다른 그룹은 정상 소비) 우리 그룹만 lag이 고정된 채 재기동 전까지 멈춘다(실측).
 * Lettuce는 자동 재연결하므로 컨테이너만 죽지 않으면 다음 poll부터 스스로 복구된다.
 */
@Component
public class CaptionStreamConsumer implements SmartLifecycle {

    private static final Logger log = LoggerFactory.getLogger(CaptionStreamConsumer.class);
    private static final int MAX_DRAIN_ITERATIONS = 1000;

    /**
     * 연결 장애 중 poll이 즉시 실패하며 도는 것을 막는 백오프. cancelOnError=false로 루프를 살려두면
     * 연결이 죽은 동안 XREADGROUP이 블로킹 없이 곧바로 실패하므로, 이 sleep이 없으면 초당 수천 번
     * 재시도하며 CPU와 로그를 소모한다.
     */
    private static final Duration CONNECTIVITY_BACKOFF = Duration.ofSeconds(1);

    /** 같은 장애가 계속될 때 ERROR 로그를 이 간격으로만 남긴다(그 사이는 debug). */
    private static final long ERROR_LOG_INTERVAL_MS = 30_000L;

    /** 마지막 오류 이후 이 시간이 지나면 새 장애로 보고 카운터를 리셋한다(→ 다시 ERROR로 즉시 보고). */
    private static final long ERROR_EPISODE_RESET_MS = 60_000L;

    private final RedisConnectionFactory connectionFactory;
    private final StringRedisTemplate redisTemplate;
    private final CaptionStreamListener listener;
    private final CaptionStreamProperties properties;

    private volatile StreamMessageListenerContainer<String, MapRecord<String, String, String>> container;
    private volatile boolean running;

    /** 연속 오류 카운터와 마지막 ERROR 로그 시각, poll 스레드 하나만 만지지만 조회는 밖에서도 한다. */
    private volatile long consecutiveErrors;
    private volatile long lastErrorAtMs;
    private volatile long lastErrorLogAtMs;

    public CaptionStreamConsumer(RedisConnectionFactory connectionFactory,
                                 StringRedisTemplate redisTemplate,
                                 CaptionStreamListener listener,
                                 CaptionStreamProperties properties) {
        this.connectionFactory = connectionFactory;
        this.redisTemplate = redisTemplate;
        this.listener = listener;
        this.properties = properties;
    }

    @Override
    public void start() {
        if (running) {
            return;
        }
        if (!properties.enabledFlag()) {
            log.info("자막 consumer 비활성(liveclass.caption.enabled=false)");
            return;
        }
        String streamKey = properties.streamKey();
        String group = properties.effectiveGroup();
        Consumer consumer = Consumer.from(group, properties.consumer());

        ensureGroup(streamKey, group);
        drainOwnedPending(streamKey, consumer);
        resetErrorEpisode();

        StreamMessageListenerContainerOptions<String, MapRecord<String, String, String>> options =
                StreamMessageListenerContainerOptions.builder()
                        .pollTimeout(properties.pollTimeout())
                        .batchSize(properties.batchSize())
                        .serializer(new StringRedisSerializer())
                        .errorHandler(this::handleContainerError)
                        .build();
        StreamMessageListenerContainer<String, MapRecord<String, String, String>> c =
                StreamMessageListenerContainer.create(connectionFactory, options);
        c.register(readRequest(streamKey, consumer), listener);
        c.start();
        this.container = c;
        this.running = true;
        log.info("자막 consumer 시작 key={} group={} consumer={}", streamKey, group, properties.consumer());
    }

    @Override
    public void stop() {
        running = false;
        StreamMessageListenerContainer<String, MapRecord<String, String, String>> c = this.container;
        if (c != null) {
            c.stop();
            this.container = null;
        }
    }

    @Override
    public boolean isRunning() {
        return running;
    }

    @Override
    public boolean isAutoStartup() {
        return properties.enabledFlag();
    }

    /**
     * poll 등록 요청. 클래스 javadoc의 복원력 정책이 여기에 코드로 구현돼 있다.
     * {@code cancelOnError(t -> false)}가 없으면 일시 오류 하나로 자막 소비가 영구 정지한다.
     *
     * <p>package-private인 이유: 이 정책(cancelOnError=false, autoAcknowledge=false)이 유지되는지
     * 단위 테스트가 컨테이너·Redis 없이 직접 확인한다({@code CaptionStreamConsumerReadRequestTest}).
     *
     * @return 수동 ACK + 오류 시 구독 유지로 구성된 {@code ">"}(lastConsumed) 읽기 요청
     */
    StreamReadRequest<String> readRequest(String streamKey, Consumer consumer) {
        // 수동 ACK: ReadOffset.lastConsumed()(">")로 새 엔트리만 받고, 처리 후 listener가 XACK한다.
        return StreamReadRequest.builder(StreamOffset.create(streamKey, ReadOffset.lastConsumed()))
                .consumer(consumer)
                .autoAcknowledge(false)
                // 기본값 t -> true(구독 취소)를 반드시 덮어쓴다. 회귀 시 자막이 오류 없이 멈춘다.
                .cancelOnError(t -> false)
                .errorHandler(this::handleContainerError)
                .build();
    }

    /** group 생성(MKSTREAM). 이미 있으면 BUSYGROUP이라 무시한다(참조 구현 대칭). */
    private void ensureGroup(String streamKey, String group) {
        try {
            redisTemplate.execute((org.springframework.data.redis.core.RedisCallback<Object>) connection -> {
                connection.streamCommands().xGroupCreate(
                        streamKey.getBytes(StandardCharsets.UTF_8), group, ReadOffset.from("0"), true);
                return null;
            });
        } catch (RuntimeException e) {
            if (isBusyGroup(e)) {
                log.debug("자막 consumer group 이미 존재 group={}", group);
                return;
            }
            throw e;
        }
    }

    /**
     * 컨테이너 poll 오류 처리. 구독은 {@code cancelOnError(t -> false)} 덕분에 살아 있으므로 여기서는
     * (1) 장애를 보이게 남기고 (2) 연결 장애면 재시도를 늦춘다.
     *
     * <p>정지 중(!running)이거나 blocking XREADGROUP이 연결 종료로 취소된
     * {@link java.util.concurrent.CancellationException}은 컨텍스트 종료 시의 정상 잡음이라 debug로 낮춘다.
     *
     * <p>로그 폭주 방지: 장애 에피소드의 첫 오류는 항상 ERROR로 남기고, 계속 실패하는 동안은
     * {@value #ERROR_LOG_INTERVAL_MS}ms마다 누적 횟수를 담아 ERROR로 요약한다(그 사이는 debug).
     * 마지막 오류로부터 {@value #ERROR_EPISODE_RESET_MS}ms가 지나면 새 에피소드로 보고 다시 즉시 ERROR다.
     * 삼키지는 않는다. 모든 오류는 최소 debug로 남고 장애는 ERROR로 반드시 드러난다.
     */
    private void handleContainerError(Throwable t) {
        if (!running || hasCancellation(t)) {
            log.debug("자막 consumer 정지/취소 중 poll 종료", t);
            return;
        }
        long now = System.currentTimeMillis();
        long errors = (now - lastErrorAtMs > ERROR_EPISODE_RESET_MS) ? 1 : consecutiveErrors + 1;
        consecutiveErrors = errors;
        lastErrorAtMs = now;

        if (errors == 1) {
            lastErrorLogAtMs = now;
            log.error("자막 consumer 처리 오류 — 구독은 유지하고 재시도한다(엔트리는 pending 유지)", t);
        } else if (now - lastErrorLogAtMs >= ERROR_LOG_INTERVAL_MS) {
            lastErrorLogAtMs = now;
            log.error("자막 consumer 오류 지속 — 누적 {}회, 여전히 재시도 중(엔트리는 pending 유지)", errors, t);
        } else {
            log.debug("자막 consumer 오류 반복 {}회(요약 로그로 집계)", errors, t);
        }

        if (isConnectivityFailure(t)) {
            backOff();
        }
    }

    /**
     * 연결·타임아웃 계열 장애 판별. 이 경우에만 백오프한다. poll 자체가 즉시 실패해 busy loop가 되기
     * 때문이다. listener 처리 오류(예: DB 일시 장애)는 엔트리 단위로 다음 엔트리로 진행하므로 루프가
     * 폭주하지 않아 지연을 넣지 않는다.
     */
    private boolean isConnectivityFailure(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof DataAccessResourceFailureException || t instanceof QueryTimeoutException
                    || t instanceof IOException) {
                return true;
            }
        }
        return false;
    }

    /** 재시도 백오프. 종료 신호(interrupt)는 즉시 존중해 셧다운을 늦추지 않는다. */
    private void backOff() {
        try {
            Thread.sleep(CONNECTIVITY_BACKOFF.toMillis());
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
    }

    private void resetErrorEpisode() {
        consecutiveErrors = 0;
        lastErrorAtMs = 0;
        lastErrorLogAtMs = 0;
    }

    private boolean hasCancellation(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof java.util.concurrent.CancellationException) {
                return true;
            }
        }
        return false;
    }

    private boolean isBusyGroup(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t.getMessage() != null && t.getMessage().contains("BUSYGROUP")) {
                return true;
            }
        }
        return false;
    }

    /**
     * 재기동 시 이 consumer가 이전에 배정받고 ACK 못 한 pending을 다시 처리한다(XREADGROUP id "0").
     * 안정 consumer 이름을 쓰므로 재기동 후 자기 pending을 되찾는다. poison은 listener가 ACK 폐기하므로
     * 무한 루프가 나지 않지만 안전 상한을 둔다.
     */
    private void drainOwnedPending(String streamKey, Consumer consumer) {
        StreamOffset<String> pendingOffset = StreamOffset.create(streamKey, ReadOffset.from("0"));
        StreamReadOptions readOptions = StreamReadOptions.empty().count(properties.batchSize());
        for (int i = 0; i < MAX_DRAIN_ITERATIONS; i++) {
            List<MapRecord<String, String, String>> pending =
                    redisTemplate.<String, String>opsForStream().read(consumer, readOptions, pendingOffset);
            if (pending == null || pending.isEmpty()) {
                return;
            }
            log.info("자막 consumer 부팅 pending drain {}건 group={}", pending.size(), consumer.getGroup());
            for (MapRecord<String, String, String> record : pending) {
                listener.onMessage(record);
            }
        }
        log.warn("자막 consumer pending drain 상한({}) 도달 — 남은 pending은 정상 소비로 처리", MAX_DRAIN_ITERATIONS);
    }
}
