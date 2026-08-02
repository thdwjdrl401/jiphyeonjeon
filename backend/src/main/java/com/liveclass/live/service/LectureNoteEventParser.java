package com.liveclass.live.service;

import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Redis 엔트리의 필드 맵을 {@link LectureNoteEvent}로 옮긴다(CONTRACT §3-4a).
 *
 * <p>여기서만 wire 표현을 안다. 누적 규칙({@link LectureNoteAccumulator})은 타입만 보므로,
 * 발행 형식이 바뀌어도 규칙은 그대로다.
 *
 * <p>모르는 {@code type}은 <b>오류가 아니다</b>. 옛 구현이 남긴 이벤트나 나중에 늘어난 이벤트가
 * 섞여 있을 수 있고, 그때마다 소비가 멈추면 안 된다 — empty로 돌려 조용히 폐기한다.
 */
@Component
public class LectureNoteEventParser {

    /** @return 다룰 수 있는 이벤트면 그것, 모르는 type이거나 형식이 어긋나면 empty(폐기 대상) */
    public Optional<LectureNoteEvent> parse(Map<String, String> fields) {
        String type = fields.get("type");
        String eventId = fields.get("eventId");
        if (type == null || eventId == null) {
            return Optional.empty();
        }
        UUID sessionId = uuid(fields.get("sessionId"));
        UUID lessonId = uuid(fields.get("lessonId"));
        if (sessionId == null || lessonId == null) {
            return Optional.empty();
        }
        return switch (type) {
            case "lecture.note.chunk.appended" -> Optional.of(new LectureNoteEvent.ChunkAppended(
                    eventId, sessionId, lessonId,
                    number(fields.get("chunkSequence")),
                    number(fields.get("latestSttSequence")),
                    fields.getOrDefault("topicAction", "CONTINUE"),
                    fields.get("topicId"),
                    fields.getOrDefault("topicTitle", ""),
                    fields.getOrDefault("keyPoints", "[]"),
                    fields.getOrDefault("markdownFragment", "")));
            case "lecture.note.capture.completed" -> Optional.of(new LectureNoteEvent.CaptureCompleted(
                    eventId, sessionId, lessonId,
                    number(fields.get("lastChunkSequence")),
                    number(fields.get("lastSttSequence")),
                    fields.getOrDefault("reason", "")));
            case "lecture.note.refined.snapshot" -> Optional.of(new LectureNoteEvent.RefinedSnapshot(
                    eventId, sessionId, lessonId,
                    number(fields.get("sourceLastChunkSequence")),
                    fields.getOrDefault("topics", "[]"),
                    fields.getOrDefault("markdownSnapshot", "")));
            // 옛 구현이 남긴 lecture.note.snapshot 등. 발행 코드는 이미 사라졌고 재생할 일도 없다.
            default -> Optional.empty();
        };
    }

    private static UUID uuid(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return UUID.fromString(raw);
        } catch (IllegalArgumentException malformed) {
            return null;
        }
    }

    private static long number(String raw) {
        if (raw == null || raw.isBlank()) {
            return 0L;
        }
        try {
            return Long.parseLong(raw.trim());
        } catch (NumberFormatException malformed) {
            return 0L;
        }
    }
}
