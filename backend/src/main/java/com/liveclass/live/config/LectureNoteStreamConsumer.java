package com.liveclass.live.config;

import com.liveclass.live.service.LectureNoteStreamListener;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.SmartLifecycle;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.connection.stream.Consumer;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.connection.stream.ReadOffset;
import org.springframework.data.redis.connection.stream.StreamOffset;
import org.springframework.data.redis.connection.stream.StreamReadOptions;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.serializer.StringRedisSerializer;
import org.springframework.data.redis.stream.StreamMessageListenerContainer;
import org.springframework.data.redis.stream.StreamMessageListenerContainer.StreamMessageListenerContainerOptions;
import org.springframework.data.redis.stream.StreamMessageListenerContainer.StreamReadRequest;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;

/**
 * 강의 노트 Redis Stream consumer(CONTRACT §3-4a).
 *
 * <p>{@link CaptionStreamConsumer}와 <b>같은 정책</b>을 쓴다 — 그쪽 javadoc에 각 선택의 이유가 자세히
 * 적혀 있다. 요점만 다시 적으면:
 * <ul>
 *   <li>컨테이너를 시작하기 <b>전에</b> group을 만든다(BUSYGROUP 무시, {@code MKSTREAM}).</li>
 *   <li>재기동 시 자기 consumer의 pending을 먼저 drain한다 — 안정 consumer 이름을 쓰므로 되찾는다.</li>
 *   <li><b>{@code cancelOnError(t -> false)}</b>가 핵심이다. 기본값이면 네트워크가 한 번 끊겨도 poll 루프가
 *       끝나 소비가 <b>영구 정지</b>한다.</li>
 *   <li>{@code autoAcknowledge(false)} — ACK는 listener가 엔트리별로 한다. 갭인 조각은 ACK하지 않고
 *       pending에 남겨야 나중에 이어지기 때문이다.</li>
 * </ul>
 *
 * <p>기본이 꺼짐이다({@code liveclass.lecture-note.enabled}). 켜는 순간 운영 노트가 쌓이기 시작하므로
 * 환경별로 명시적으로 켠다.
 */
@Component
public class LectureNoteStreamConsumer implements SmartLifecycle {

    private static final Logger log = LoggerFactory.getLogger(LectureNoteStreamConsumer.class);
    private static final int MAX_DRAIN_ITERATIONS = 1000;
    private static final Duration CONNECTIVITY_BACKOFF = Duration.ofSeconds(1);
    private static final long ERROR_LOG_INTERVAL_MS = 30_000L;
    private static final long ERROR_EPISODE_RESET_MS = 60_000L;

    private final RedisConnectionFactory connectionFactory;
    private final StringRedisTemplate redisTemplate;
    private final LectureNoteStreamListener listener;
    private final LectureNoteStreamProperties properties;

    private volatile StreamMessageListenerContainer<String, MapRecord<String, String, String>> container;
    private volatile boolean running;
    private volatile long consecutiveErrors;
    private volatile long lastErrorAtMs;
    private volatile long lastErrorLogAtMs;

    public LectureNoteStreamConsumer(RedisConnectionFactory connectionFactory,
                                     StringRedisTemplate redisTemplate,
                                     LectureNoteStreamListener listener,
                                     LectureNoteStreamProperties properties) {
        this.connectionFactory = connectionFactory;
        this.redisTemplate = redisTemplate;
        this.listener = listener;
        this.properties = properties;
    }

    @Override
    public void start() {
        if (running || !properties.enabledFlag()) {
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
        log.info("강의 노트 consumer 시작 key={} group={} consumer={}", streamKey, group, properties.consumer());
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
     * poll 등록 요청. package-private인 이유는 자막 쪽과 같다 — 이 두 정책이 유지되는지 단위 테스트가
     * 컨테이너·Redis 없이 확인한다. 회귀하면 노트 소비가 <b>조용히</b> 멈춘다.
     */
    StreamReadRequest<String> readRequest(String streamKey, Consumer consumer) {
        return StreamReadRequest.builder(StreamOffset.create(streamKey, ReadOffset.lastConsumed()))
                .consumer(consumer)
                .autoAcknowledge(false)
                .cancelOnError(t -> false)
                .errorHandler(this::handleContainerError)
                .build();
    }

    /** group 생성(MKSTREAM). 이미 있으면 BUSYGROUP이라 무시한다. */
    private void ensureGroup(String streamKey, String group) {
        try {
            redisTemplate.execute((org.springframework.data.redis.core.RedisCallback<Object>) connection -> {
                connection.streamCommands().xGroupCreate(
                        streamKey.getBytes(StandardCharsets.UTF_8), group, ReadOffset.from("0"), true);
                return null;
            });
        } catch (RuntimeException e) {
            if (contains(e, "BUSYGROUP")) {
                log.debug("강의 노트 consumer group 이미 존재 group={}", group);
                return;
            }
            throw e;
        }
    }

    /** 자막 쪽과 같은 로그 폭주 방지: 에피소드 첫 오류는 ERROR, 이후는 주기 요약, 그 사이는 debug. */
    private void handleContainerError(Throwable t) {
        if (!running || hasCancellation(t)) {
            log.debug("강의 노트 consumer 정지/취소 중 poll 종료", t);
            return;
        }
        long now = System.currentTimeMillis();
        long errors = (now - lastErrorAtMs > ERROR_EPISODE_RESET_MS) ? 1 : consecutiveErrors + 1;
        consecutiveErrors = errors;
        lastErrorAtMs = now;

        if (errors == 1) {
            lastErrorLogAtMs = now;
            log.error("강의 노트 consumer 처리 오류 — 구독은 유지하고 재시도한다(엔트리는 pending 유지)", t);
        } else if (now - lastErrorLogAtMs >= ERROR_LOG_INTERVAL_MS) {
            lastErrorLogAtMs = now;
            log.error("강의 노트 consumer 오류 지속 — 누적 {}회, 여전히 재시도 중", errors, t);
        } else {
            log.debug("강의 노트 consumer 오류 반복 {}회(요약 로그로 집계)", errors, t);
        }

        if (isConnectivityFailure(t)) {
            backOff();
        }
    }

    /** 연결·타임아웃 계열만 백오프한다 — poll 자체가 즉시 실패해 busy loop가 되기 때문이다. */
    private boolean isConnectivityFailure(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof DataAccessResourceFailureException || t instanceof QueryTimeoutException
                    || t instanceof IOException) {
                return true;
            }
        }
        return false;
    }

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

    private boolean contains(Throwable e, String needle) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t.getMessage() != null && t.getMessage().contains(needle)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 재기동 시 이 consumer가 배정받고 ACK 못 한 pending을 다시 처리한다(XREADGROUP id "0").
     *
     * <p>노트에서는 이 drain이 자막보다 더 중요하다 — 갭인 조각을 일부러 ACK하지 않고 남기므로,
     * 앞 조각이 도착한 뒤 이 경로로 다시 처리돼야 노트가 이어진다.
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
            log.info("강의 노트 consumer 부팅 pending drain {}건 group={}", pending.size(), consumer.getGroup());
            for (MapRecord<String, String, String> record : pending) {
                listener.onMessage(record);
            }
        }
        log.warn("강의 노트 consumer pending drain 상한({}) 도달", MAX_DRAIN_ITERATIONS);
    }
}
