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
import org.springframework.data.redis.stream.StreamMessageListenerContainer;
import org.springframework.data.redis.stream.StreamMessageListenerContainer.StreamMessageListenerContainerOptions;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * 라이브 자막 Redis Stream consumer 배선(ADR-0043, CONTRACT §3-4). 기존 자동설정
 * {@link RedisConnectionFactory}(=프로필 구동 {@code spring.data.redis} Redis)를 재사용해
 * {@link StreamMessageListenerContainer}(Lettuce)로 소비한다.
 *
 * <p>{@link SmartLifecycle}로 컨테이너 수명을 직접 통제한다 — 컨테이너를 시작하기 <b>전에</b> group을
 * 만들고(BUSYGROUP 무시, {@code MKSTREAM}) 재기동 시 자기 consumer의 pending을 drain해야 하기 때문이다.
 * 수동 ACK 모드({@code receive})로 등록해 {@link CaptionStreamListener}가 엔트리별로 ACK한다.
 */
@Component
public class CaptionStreamConsumer implements SmartLifecycle {

    private static final Logger log = LoggerFactory.getLogger(CaptionStreamConsumer.class);
    private static final int MAX_DRAIN_ITERATIONS = 1000;

    private final RedisConnectionFactory connectionFactory;
    private final StringRedisTemplate redisTemplate;
    private final CaptionStreamListener listener;
    private final CaptionStreamProperties properties;

    private volatile StreamMessageListenerContainer<String, MapRecord<String, String, String>> container;
    private volatile boolean running;

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

        StreamMessageListenerContainerOptions<String, MapRecord<String, String, String>> options =
                StreamMessageListenerContainerOptions.builder()
                        .pollTimeout(properties.pollTimeout())
                        .batchSize(properties.batchSize())
                        .serializer(new StringRedisSerializer())
                        .errorHandler(this::handleContainerError)
                        .build();
        StreamMessageListenerContainer<String, MapRecord<String, String, String>> c =
                StreamMessageListenerContainer.create(connectionFactory, options);
        // 수동 ACK: ReadOffset.lastConsumed()(">")로 새 엔트리만 받고, 처리 후 listener가 XACK한다.
        c.receive(consumer, StreamOffset.create(streamKey, ReadOffset.lastConsumed()), listener);
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
     * 컨테이너 poll 오류 처리. 정지 중(!running)이거나 blocking XREADGROUP이 연결 종료로 취소된
     * {@link java.util.concurrent.CancellationException}은 컨텍스트 종료 시의 정상 잡음이라 debug로 낮춘다.
     * 그 외 처리 오류는 error로 남기고 엔트리는 pending에 유지된다(재소비 대상).
     */
    private void handleContainerError(Throwable t) {
        if (!running || hasCancellation(t)) {
            log.debug("자막 consumer 정지/취소 중 poll 종료", t);
            return;
        }
        log.error("자막 consumer 처리 오류(엔트리는 pending 유지)", t);
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
