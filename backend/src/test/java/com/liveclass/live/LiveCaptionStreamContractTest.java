package com.liveclass.live;

import com.liveclass.live.config.CaptionStreamProperties;
import com.liveclass.live.domain.LiveCaption;
import com.liveclass.live.repository.LiveCaptionRepository;
import com.liveclass.live.service.CaptionEvent;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.StringRedisTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.function.BooleanSupplier;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Python↔Spring 자막 스트림 필드 계약 + 소비/영속/ACK 핵심 경로 계약 테스트(POLICY: 공유 스트림 필드
 * 계약 + 자막 전달 핵심경로, ADR-0043). 정본 fixture
 * {@code ai/realtime-agent/contracts/fixtures/*.valid.json}를 그대로 XADD해 양측 정합을 고정한다:
 * <ul>
 *   <li>delta·completed fixture XADD → 소비 → PG 저장 + ACK(pending 0).</li>
 *   <li>같은 eventId 중복 XADD → 1행만(멱등키=eventId).</li>
 *   <li>poison(스키마 위반) → 저장 안 함 + ACK 폐기(pending 0).</li>
 * </ul>
 * consumer는 격리된 stream-key/group으로 재활성화한다(기본은 테스트에서 off — 교차 오염 방지).
 */
@SpringBootTest(properties = {
        "liveclass.caption.enabled=true",
        "liveclass.caption.stream-key=ai:captions:test:consume",
        "liveclass.caption.group=spring-caption-test-consume",
        "liveclass.caption.consumer=consume-1"
})
class LiveCaptionStreamContractTest {

    private static final UUID FIXTURE_SESSION_ID = UUID.fromString("11111111-1111-4111-8111-111111111111");

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private LiveCaptionRepository repository;

    @Autowired
    private CaptionStreamProperties properties;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Test
    void fixtures_are_consumed_persisted_and_acked_with_idempotency_and_poison_discard() throws Exception {
        String key = properties.streamKey();

        // 1) delta fixture XADD → 소비 → PG 저장.
        redis.opsForStream().add(key, fixture("caption-delta.valid.json"));
        await(() -> repository.existsByEventId("caption-event-1"));

        LiveCaption delta = repository.findByEventId("caption-event-1").orElseThrow();
        assertThat(delta.getEventType()).isEqualTo("caption.delta");
        assertThat(delta.getSessionId()).isEqualTo(FIXTURE_SESSION_ID);
        assertThat(delta.getSttSessionId()).isEqualTo("openai-realtime:session-1");
        assertThat(delta.getSequence()).isEqualTo(1L);
        assertThat(delta.getStreamElapsedMs()).isEqualTo(41000L);   // raw attempt-local ms(변환 금지)
        assertThat(delta.getText()).isEqualTo(" 외");
        assertThat(delta.getLastSequence()).isNull();
        assertThat(delta.getReason()).isNull();

        // 2) 같은 eventId 중복 XADD → 여전히 1행(멱등).
        redis.opsForStream().add(key, fixture("caption-delta.valid.json"));

        // 3) completed fixture XADD → 종료 마커 영속.
        redis.opsForStream().add(key, fixture("caption-completed.valid.json"));
        await(() -> repository.existsByEventId("caption-event-2"));

        LiveCaption completed = repository.findByEventId("caption-event-2").orElseThrow();
        assertThat(completed.getEventType()).isEqualTo("caption.stream.completed");
        assertThat(completed.getLastSequence()).isEqualTo(1L);
        assertThat(completed.getReason()).isEqualTo("ROOM_DELETED");
        assertThat(completed.getSequence()).isNull();
        assertThat(completed.getText()).isNull();

        // 4) started fixture XADD → 시간 앵커 영속(ADR-0052). 단일 streamElapsedMs 없음.
        redis.opsForStream().add(key, fixture("caption-stream-started.valid.json"));
        await(() -> repository.existsByEventId("caption-event-started-1"));

        LiveCaption started = repository.findByEventId("caption-event-started-1").orElseThrow();
        assertThat(started.getEventType()).isEqualTo("caption.stream.started");
        assertThat(started.getAudioStartedAt().toInstant())
                .isEqualTo(OffsetDateTime.parse("2026-07-27T12:34:15.789Z").toInstant());
        assertThat(started.getStreamElapsedMs()).isNull();
        assertThat(started.getSequence()).isNull();
        assertThat(started.getText()).isNull();
        assertThat(started.getSegmentIndex()).isNull();

        // 5) segment.final fixture XADD → 발화 경계·시각 영속(ADR-0052).
        redis.opsForStream().add(key, fixture("caption-segment-final.valid.json"));
        await(() -> repository.existsByEventId("caption-event-segment-1"));

        LiveCaption segment = repository.findByEventId("caption-event-segment-1").orElseThrow();
        assertThat(segment.getEventType()).isEqualTo("caption.segment.final");
        assertThat(segment.getSegmentIndex()).isEqualTo(0L);
        assertThat(segment.getLastSequence()).isEqualTo(1L);
        assertThat(segment.getText()).isEqualTo(" 외");
        assertThat(segment.getStartStreamElapsedMs()).isEqualTo(40000L);
        assertThat(segment.getEndStreamElapsedMs()).isEqualTo(41000L);
        assertThat(segment.getBoundaryReason()).isEqualTo("SILENCE");
        assertThat(segment.getStreamElapsedMs()).isNull();   // 단일 좌표 없음

        // 6) poison(sessionId 누락 → 스키마 위반) → 저장 안 함, ACK 폐기.
        Map<String, String> poison = new LinkedHashMap<>();
        poison.put("contractVersion", "1");
        poison.put("type", "caption.delta");
        poison.put("eventId", "poison-1");
        poison.put("lessonId", "22222222-2222-4222-8222-222222222222");
        poison.put("sttSessionId", "openai-realtime:session-1");
        poison.put("sequence", "2");
        poison.put("streamElapsedMs", "42000");
        poison.put("text", "깨진 엔트리");
        poison.put("occurredAt", "2026-07-27T12:34:57.000Z");
        redis.opsForStream().add(key, poison);

        // 모든 엔트리가 ACK되어 pending이 0으로 수렴한다(poison 폐기 포함).
        await(() -> pending(key) == 0L);

        assertThat(repository.existsByEventId("poison-1")).isFalse();
        // delta·completed·started·segment.final = 4행. 중복 delta·poison은 늘리지 않는다.
        assertThat(repository.countBySessionId(FIXTURE_SESSION_ID)).isEqualTo(4L);

        // 7) 표시 대상 필터(RELAYED_TYPES, ADR-0052 2차): WS/리로드는 delta·completed·segment.final을 노출하고
        //    started(시간 앵커)는 배제한다. 4행 중 started 1행만 빠진 3행.
        assertThat(repository.findBySessionIdAndEventTypeInOrderByOccurredAtAscIdAsc(
                FIXTURE_SESSION_ID, CaptionEvent.RELAYED_TYPES)).hasSize(3);
        // 8) RAG contextTimeMs(CONTEXT_TIME_TYPES): segment.final(occurredAt 12:34:56.790Z)이 delta(…789Z)보다
        //    늦지만 단일 streamElapsedMs가 없어 제외 → 최신 좌표 행은 streamElapsedMs가 있는 delta/completed다
        //    (신규 type 최신행에서 null NPE 나던 회귀 방지).
        LiveCaption latestCtx = repository.findFirstBySessionIdAndEventTypeInOrderByOccurredAtDescIdDesc(
                FIXTURE_SESSION_ID, CaptionEvent.CONTEXT_TIME_TYPES).orElseThrow();
        assertThat(CaptionEvent.CONTEXT_TIME_TYPES).contains(latestCtx.getEventType());
        assertThat(latestCtx.getStreamElapsedMs()).isNotNull();
    }

    private long pending(String key) {
        var summary = redis.opsForStream().pending(key, properties.effectiveGroup());
        return summary == null ? 0L : summary.getTotalPendingMessages();
    }

    /** fixture JSON(object of string fields) → XADD용 Map. */
    private Map<String, String> fixture(String name) throws Exception {
        Path path = fixturePath(name);
        JsonNode node = jsonMapper.readTree(Files.readString(path));
        Map<String, String> fields = new LinkedHashMap<>();
        for (Map.Entry<String, JsonNode> e : node.properties()) {
            fields.put(e.getKey(), e.getValue().asString());
        }
        return fields;
    }

    private static Path fixturePath(String name) {
        Path[] candidates = {
                Path.of("..", "ai", "realtime-agent", "contracts", "fixtures", name),
                Path.of("ai", "realtime-agent", "contracts", "fixtures", name)
        };
        for (Path candidate : candidates) {
            if (Files.exists(candidate)) {
                return candidate;
            }
        }
        throw new IllegalStateException("fixture를 찾을 수 없습니다: " + name);
    }

    private static void await(BooleanSupplier condition) throws InterruptedException {
        Instant deadline = Instant.now().plus(Duration.ofSeconds(15));
        while (Instant.now().isBefore(deadline)) {
            if (condition.getAsBoolean()) {
                return;
            }
            Thread.sleep(100);
        }
        throw new AssertionError("조건이 시간 내에 충족되지 않았습니다.");
    }
}
