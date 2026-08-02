package com.liveclass.live;

import com.liveclass.live.service.LectureNoteEvent;
import com.liveclass.live.service.LectureNoteEventParser;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Redis 필드 맵 → 이벤트 변환(CONTRACT §3-4a).
 *
 * <p>여기서만 wire 표현을 안다. 특히 <b>모르는 type이 소비를 멈추면 안 된다</b> — 옛 구현이 남긴
 * {@code lecture.note.snapshot}이 스트림에 아직 남아 있고, 나중에 이벤트가 늘어날 수도 있다.
 */
class LectureNoteEventParserTest {

    private final LectureNoteEventParser parser = new LectureNoteEventParser();

    private Map<String, String> base(String type) {
        Map<String, String> f = new HashMap<>();
        f.put("type", type);
        f.put("eventId", "evt-1");
        f.put("sessionId", UUID.randomUUID().toString());
        f.put("lessonId", UUID.randomUUID().toString());
        return f;
    }

    @Test
    void parses_a_chunk() {
        Map<String, String> f = base("lecture.note.chunk.appended");
        f.put("chunkSequence", "3");
        f.put("latestSttSequence", "17");
        f.put("topicAction", "START_NEW");
        f.put("topicId", "topic-1");
        f.put("topicTitle", "한양도성의 설계 특징");
        f.put("keyPoints", "[\"구멍은 설계였다\"]");
        f.put("markdownFragment", "## 한양도성의 설계 특징");

        LectureNoteEvent.ChunkAppended event = (LectureNoteEvent.ChunkAppended) parser.parse(f).orElseThrow();
        assertThat(event.chunkSequence()).isEqualTo(3);
        assertThat(event.latestSttSequence()).isEqualTo(17);
        assertThat(event.startsNewTopic()).isTrue();
        assertThat(event.topicTitle()).isEqualTo("한양도성의 설계 특징");
    }

    @Test
    void parses_completion_and_refined() {
        Map<String, String> completed = base("lecture.note.capture.completed");
        completed.put("lastChunkSequence", "1");
        completed.put("lastSttSequence", "17");
        completed.put("reason", "ROOM_DELETED");
        assertThat(parser.parse(completed)).containsInstanceOf(LectureNoteEvent.CaptureCompleted.class);

        Map<String, String> refined = base("lecture.note.refined.snapshot");
        refined.put("sourceLastChunkSequence", "1");
        refined.put("topics", "[]");
        refined.put("markdownSnapshot", "## 정리");
        assertThat(parser.parse(refined)).containsInstanceOf(LectureNoteEvent.RefinedSnapshot.class);
    }

    @Test
    void an_unknown_type_is_dropped_not_thrown() {
        // 07/30 이전 구현이 남긴 타입. 발행 코드는 사라졌지만 스트림에는 남아 있다.
        assertThat(parser.parse(base("lecture.note.snapshot"))).isEmpty();
        assertThat(parser.parse(base("lecture.note.something.new"))).isEmpty();
    }

    @Test
    void a_malformed_entry_is_dropped() {
        Map<String, String> noSession = base("lecture.note.chunk.appended");
        noSession.remove("sessionId");
        assertThat(parser.parse(noSession)).isEmpty();

        Map<String, String> badUuid = base("lecture.note.chunk.appended");
        badUuid.put("sessionId", "세션아님");
        assertThat(parser.parse(badUuid)).isEmpty();

        assertThat(parser.parse(Map.of())).isEmpty();
    }

    @Test
    void a_non_numeric_sequence_falls_back_to_zero_instead_of_throwing() {
        Map<String, String> f = base("lecture.note.chunk.appended");
        f.put("chunkSequence", "일");

        // 숫자가 아니면 0으로 본다 — 던지면 그 엔트리 하나가 소비를 멈춘다.
        LectureNoteEvent.ChunkAppended event = (LectureNoteEvent.ChunkAppended) parser.parse(f).orElseThrow();
        assertThat(event.chunkSequence()).isZero();
    }
}
