package com.liveclass.live.service;

import com.liveclass.live.api.LiveLectureNoteView;
import com.liveclass.live.domain.LiveLectureNote;
import com.liveclass.live.repository.LiveLectureNoteRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;

/**
 * 노트 이벤트를 read model에 반영한다(CONTRACT §3-4a).
 *
 * <p>여기가 이 기능에서 <b>어려운 부분</b>이다. at-least-once 스트림이라 같은 이벤트가 다시 오고,
 * 순서가 뒤집히고, 중간이 빠질 수 있다. 계약이 요구하는 세 가지를 그대로 지킨다.
 *
 * <ul>
 *   <li><b>이미 반영한 조각은 무시한다</b> — 재전송이 안전해야 한다.</li>
 *   <li><b>기대값보다 큰 조각은 반영하지 않는다</b> — 중간이 빠진 채 이어 붙이면 노트가 조용히
 *       어긋난다. 반영하지 않고 로그만 남겨 pending에 남게 둔다(뒤늦게 도착한 앞 조각이 채운다).</li>
 *   <li><b>완료는 순번이 맞을 때만</b> — 빠진 조각이 있는데 완료로 확정하면 그 구멍이 영구히 남는다.</li>
 * </ul>
 *
 * <p>Redis를 모른다. 이벤트를 받아 노트를 고치는 일만 해서, 스트림 없이 규칙을 시험할 수 있다.
 */
@Service
public class LectureNoteAccumulator {

    private static final Logger log = LoggerFactory.getLogger(LectureNoteAccumulator.class);

    private final LiveLectureNoteRepository repository;
    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    public LectureNoteAccumulator(LiveLectureNoteRepository repository) {
        this.repository = repository;
    }

    /**
     * 조각 하나를 반영한다.
     *
     * @return 반영했으면 새 노트, 중복·stale·갭이라 반영하지 않았으면 empty
     */
    @Transactional
    public Optional<LiveLectureNoteView> append(LectureNoteEvent.ChunkAppended event) {
        LiveLectureNote note = loadOrCreate(event.sessionId(), event.lessonId());
        long expected = note.getLastChunkSequence() + 1;

        if (event.chunkSequence() <= note.getLastChunkSequence()) {
            log.debug("이미 반영한 노트 조각 무시 session={} chunk={} 반영됨={}",
                    event.sessionId(), event.chunkSequence(), note.getLastChunkSequence());
            return Optional.empty();
        }
        if (event.chunkSequence() > expected) {
            /*
             * 중간이 빠졌다. 이어 붙이면 노트가 조용히 어긋나므로 반영하지 않는다 — ACK도 하지 않아
             * pending에 남고, 앞 조각이 도착해 순번이 맞으면 그때 이 조각도 다시 처리된다.
             */
            log.warn("노트 조각 갭 — 반영 보류 session={} 도착={} 기대={}",
                    event.sessionId(), event.chunkSequence(), expected);
            return Optional.empty();
        }

        ArrayNode topics = readTopics(note.getTopics());
        if (event.startsNewTopic() || topics.isEmpty()) {
            // 첫 조각은 모델 응답과 무관하게 새 주제다(계약). topics가 비어 있으면 CONTINUE여도 새로 연다.
            ObjectNode topic = topics.addObject();
            topic.put("topicId", event.topicId());
            topic.put("title", event.topicTitle());
            topic.set("keyPoints", readKeyPoints(event.keyPoints()));
        } else {
            // CONTINUE는 직전 주제에 요점만 더한다. 제목은 바꾸지 않는다 — 같은 주제를 이어 가는 것이다.
            ObjectNode last = (ObjectNode) topics.get(topics.size() - 1);
            ArrayNode points = last.withArrayProperty("keyPoints");
            readKeyPoints(event.keyPoints()).forEach(points::add);
        }

        note.setTopics(topics.toString());
        note.setMarkdown(appendMarkdown(note.getMarkdown(), event));
        note.setLastChunkSequence(event.chunkSequence());
        note.setCoveredThroughSequence(Math.max(note.getCoveredThroughSequence(), event.latestSttSequence()));
        note.setStatus("CAPTURING");
        note.setUpdatedAt(OffsetDateTime.now());
        return Optional.of(LiveLectureNoteService.toView(repository.save(note)));
    }

    /** 자막 수집 완료. 빠진 조각이 있으면 확정하지 않는다 — 그 구멍이 영구히 남는다. */
    @Transactional
    public Optional<LiveLectureNoteView> complete(LectureNoteEvent.CaptureCompleted event) {
        LiveLectureNote note = loadOrCreate(event.sessionId(), event.lessonId());
        if (note.getLastChunkSequence() != event.lastChunkSequence()) {
            log.warn("노트 수집 완료 보류 — 조각이 빠졌다 session={} 완료가 가리킨={} 반영됨={}",
                    event.sessionId(), event.lastChunkSequence(), note.getLastChunkSequence());
            return Optional.empty();
        }
        if ("COMPLETED".equals(note.getStatus()) || "REFINED".equals(note.getStatus())) {
            return Optional.empty();   // 이미 확정됨 — 재전송
        }
        note.setStatus("COMPLETED");
        note.setCoveredThroughSequence(Math.max(note.getCoveredThroughSequence(), event.lastSttSequence()));
        note.setUpdatedAt(OffsetDateTime.now());
        return Optional.of(LiveLectureNoteService.toView(repository.save(note)));
    }

    /**
     * 정제본으로 교체한다. live 노트에 덧붙이지 않는다(계약).
     *
     * <p>수집이 확정됐고 정제 입력이 지금 반영한 마지막 조각과 같을 때만 반영한다 — 그렇지 않으면
     * 아직 자라는 중인 노트를 옛 입력으로 만든 정제본이 덮어쓴다.
     */
    @Transactional
    public Optional<LiveLectureNoteView> refine(LectureNoteEvent.RefinedSnapshot event) {
        LiveLectureNote note = loadOrCreate(event.sessionId(), event.lessonId());
        if (!"COMPLETED".equals(note.getStatus())) {
            log.warn("정제본 보류 — 아직 수집이 확정되지 않았다 session={} status={}",
                    event.sessionId(), note.getStatus());
            return Optional.empty();
        }
        if (note.getLastChunkSequence() != event.sourceLastChunkSequence()) {
            log.warn("정제본 보류 — 입력이 어긋난다 session={} 정제입력={} 반영됨={}",
                    event.sessionId(), event.sourceLastChunkSequence(), note.getLastChunkSequence());
            return Optional.empty();
        }
        note.setTopics(event.topics());
        note.setMarkdown(event.markdownSnapshot());
        note.setStatus("REFINED");
        note.setUpdatedAt(OffsetDateTime.now());
        return Optional.of(LiveLectureNoteService.toView(repository.save(note)));
    }

    private LiveLectureNote loadOrCreate(UUID sessionId, UUID lessonId) {
        return repository.findById(sessionId).orElseGet(() -> {
            LiveLectureNote created = new LiveLectureNote();
            created.setSessionId(sessionId);
            created.setLessonId(lessonId);
            created.setTopics("[]");
            created.setMarkdown("");
            created.setStatus("CAPTURING");
            return created;
        });
    }

    /**
     * 계약이 정한 결합 규칙: 첫 조각은 그대로, {@code START_NEW} 앞에는 빈 줄 하나, {@code CONTINUE}
     * 앞에는 줄바꿈 하나.
     */
    private static String appendMarkdown(String current, LectureNoteEvent.ChunkAppended event) {
        String fragment = event.markdownFragment() == null ? "" : event.markdownFragment();
        if (current == null || current.isEmpty()) {
            return fragment;
        }
        return current + (event.startsNewTopic() ? "\n\n" : "\n") + fragment;
    }

    /** 저장된 topics를 읽는다. 깨져 있으면 빈 배열에서 다시 시작한다 — 노트 하나 때문에 소비가 멈추면 안 된다. */
    private ArrayNode readTopics(String stored) {
        if (stored == null || stored.isBlank()) {
            return jsonMapper.createArrayNode();
        }
        try {
            JsonNode parsed = jsonMapper.readTree(stored);
            return parsed.isArray() ? (ArrayNode) parsed : jsonMapper.createArrayNode();
        } catch (RuntimeException e) {
            log.warn("저장된 노트 topics를 읽지 못해 새로 시작한다: {}", e.getMessage());
            return jsonMapper.createArrayNode();
        }
    }

    /** {@code keyPoints}는 JSON 배열 문자열로 온다. 형식이 어긋나면 통째로 한 항목으로 넣지 않고 버린다. */
    private ArrayNode readKeyPoints(String raw) {
        if (raw == null || raw.isBlank()) {
            return jsonMapper.createArrayNode();
        }
        try {
            JsonNode parsed = jsonMapper.readTree(raw);
            return parsed.isArray() ? (ArrayNode) parsed : jsonMapper.createArrayNode();
        } catch (RuntimeException e) {
            log.warn("노트 keyPoints를 읽지 못해 건너뛴다: {}", e.getMessage());
            return jsonMapper.createArrayNode();
        }
    }
}
