package com.liveclass.live.service;

import com.liveclass.live.api.LiveLectureNoteView;
import com.liveclass.live.config.LectureNoteStreamProperties;
import com.liveclass.live.web.ws.WsLectureNoteBroadcaster;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.connection.stream.RecordId;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.stream.StreamListener;
import org.springframework.stereotype.Component;

import java.util.Optional;

/**
 * 강의 노트 Stream 엔트리 처리(CONTRACT §3-4a). 파싱 → 반영 → 전파 → <b>엔트리별 XACK</b>.
 *
 * <p>ACK 규칙이 이 클래스의 전부다.
 * <ul>
 *   <li><b>모르는 type·형식 오류는 ACK로 폐기한다</b> — 다시 처리해도 같은 결과라 pending에 남길 이유가 없다.</li>
 *   <li><b>반영했으면 ACK한다.</b> 중복·stale이라 반영하지 않은 경우도 ACK한다 — 이미 반영된 것이다.</li>
 *   <li><b>조각 갭은 ACK하지 않는다.</b> 앞 조각이 아직 안 왔을 뿐이라, pending에 남겨 두면 재소비 때
 *       순번이 맞아 이어진다. 여기서 ACK하면 그 조각이 영영 사라져 노트에 구멍이 남는다.</li>
 *   <li><b>일시적 오류(DB 장애 등)는 다시 던진다</b> → ACK를 건너뛰어 pending에 남고 재기동 drain으로 복구된다.</li>
 * </ul>
 */
@Component
public class LectureNoteStreamListener implements StreamListener<String, MapRecord<String, String, String>> {

    private static final Logger log = LoggerFactory.getLogger(LectureNoteStreamListener.class);

    private final LectureNoteEventParser parser;
    private final LectureNoteAccumulator accumulator;
    private final WsLectureNoteBroadcaster broadcaster;
    private final StringRedisTemplate redisTemplate;
    private final LectureNoteStreamProperties properties;

    public LectureNoteStreamListener(LectureNoteEventParser parser,
                                     LectureNoteAccumulator accumulator,
                                     WsLectureNoteBroadcaster broadcaster,
                                     StringRedisTemplate redisTemplate,
                                     LectureNoteStreamProperties properties) {
        this.parser = parser;
        this.accumulator = accumulator;
        this.broadcaster = broadcaster;
        this.redisTemplate = redisTemplate;
        this.properties = properties;
    }

    @Override
    public void onMessage(MapRecord<String, String, String> record) {
        RecordId recordId = record.getId();
        Optional<LectureNoteEvent> parsed = parser.parse(record.getValue());
        if (parsed.isEmpty()) {
            log.debug("강의 노트 엔트리 폐기(모르는 type 또는 형식 오류) id={}", recordId);
            acknowledge(recordId);
            return;
        }
        LectureNoteEvent event = parsed.get();

        // 반영 실패(일시적)는 여기서 던져 ACK를 건너뛴다 → pending 유지(재소비 대상).
        Applied applied = apply(event);
        if (applied.holdForRetry()) {
            // 갭 — 앞 조각을 기다린다. ACK하면 이 조각이 영영 사라져 노트에 구멍이 남는다.
            return;
        }
        applied.note().ifPresent(broadcaster::broadcast);
        acknowledge(recordId);
    }

    private Applied apply(LectureNoteEvent event) {
        if (event instanceof LectureNoteEvent.ChunkAppended chunk) {
            Optional<LiveLectureNoteView> note = accumulator.append(chunk);
            // 반영되지 않은 이유가 "앞이 빠졌다"인지 "이미 반영했다"인지 구분한다 — ACK 여부가 갈린다.
            boolean gap = note.isEmpty() && accumulator.isAheadOfExpected(chunk);
            return new Applied(note, gap);
        }
        if (event instanceof LectureNoteEvent.CaptureCompleted completed) {
            Optional<LiveLectureNoteView> note = accumulator.complete(completed);
            boolean gap = note.isEmpty() && accumulator.isWaitingForChunks(completed);
            return new Applied(note, gap);
        }
        if (event instanceof LectureNoteEvent.RefinedSnapshot refined) {
            Optional<LiveLectureNoteView> note = accumulator.refine(refined);
            boolean gap = note.isEmpty() && accumulator.isWaitingForCompletion(refined);
            return new Applied(note, gap);
        }
        return new Applied(Optional.empty(), false);
    }

    private void acknowledge(RecordId recordId) {
        redisTemplate.opsForStream()
                .acknowledge(properties.streamKey(), properties.effectiveGroup(), recordId);
    }

    /**
     * @param note         반영됐으면 새 노트(전파 대상)
     * @param holdForRetry 아직 반영할 수 없어 <b>ACK하지 않고</b> pending에 남길 것인가
     */
    private record Applied(Optional<LiveLectureNoteView> note, boolean holdForRetry) {
    }
}
