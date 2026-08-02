package com.liveclass.live;

import com.liveclass.live.service.LectureNoteAccumulator;
import com.liveclass.live.service.LectureNoteEvent;
import com.liveclass.live.service.LiveLectureNoteService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 노트 누적 규칙(CONTRACT §3-4a).
 *
 * <p>at-least-once 스트림이라 같은 이벤트가 다시 오고, 순서가 뒤집히고, 중간이 빠진다. 그 셋을 각각
 * 어떻게 다루는지가 이 기능의 어려운 부분이고, 여기서 고정한다.
 */
@SpringBootTest
@Transactional
class LectureNoteAccumulatorTest {

    @Autowired
    private LectureNoteAccumulator accumulator;

    @Autowired
    private LiveLectureNoteService noteService;

    private UUID session;
    private UUID lesson;

    @BeforeEach
    void setUp() {
        session = UUID.randomUUID();
        lesson = UUID.randomUUID();
    }

    private LectureNoteEvent.ChunkAppended chunk(long sequence, String action, String title, String points) {
        return new LectureNoteEvent.ChunkAppended("evt-" + UUID.randomUUID(), session, lesson,
                sequence, sequence * 10, action, "topic-" + sequence, title, points,
                ("START_NEW".equals(action) ? "## " + title + "\n" : "") + "- 요점");
    }

    @Test
    void start_new_opens_a_topic_and_continue_adds_points_to_it() {
        accumulator.append(chunk(1, "START_NEW", "필터 체인", "[\"순서가 결과를 바꾼다\"]"));
        accumulator.append(chunk(2, "CONTINUE", "무시됨", "[\"인증은 컨텍스트에 담긴다\"]"));

        String topics = noteService.find(session).topics();
        // CONTINUE는 새 주제를 만들지 않고 직전 주제에 요점만 더한다.
        assertThat(topics).contains("필터 체인").doesNotContain("무시됨");
        assertThat(topics).contains("순서가 결과를 바꾼다").contains("인증은 컨텍스트에 담긴다");

        accumulator.append(chunk(3, "START_NEW", "세션 관리", "[\"쿠키로 잇는다\"]"));
        assertThat(noteService.find(session).topics()).contains("세션 관리");
    }

    @Test
    void a_resent_chunk_is_ignored() {
        accumulator.append(chunk(1, "START_NEW", "필터 체인", "[\"첫 요점\"]"));

        // 같은 조각이 다시 와도 요점이 두 번 들어가면 안 된다 — at-least-once에서 흔한 일이다.
        assertThat(accumulator.append(chunk(1, "START_NEW", "필터 체인", "[\"첫 요점\"]"))).isEmpty();
        assertThat(noteService.find(session).topics().split("첫 요점", -1).length - 1).isEqualTo(1);
    }

    @Test
    void a_chunk_that_skips_ahead_is_not_applied() {
        accumulator.append(chunk(1, "START_NEW", "필터 체인", "[\"첫 요점\"]"));

        // 2가 아직 안 왔는데 3을 이어 붙이면 노트가 조용히 어긋난다.
        assertThat(accumulator.append(chunk(3, "CONTINUE", "", "[\"세 번째\"]"))).isEmpty();
        assertThat(noteService.find(session).topics()).doesNotContain("세 번째");

        // 빠졌던 2가 도착하면 반영되고, 그다음 3도 이어진다.
        assertThat(accumulator.append(chunk(2, "CONTINUE", "", "[\"두 번째\"]"))).isPresent();
        assertThat(accumulator.append(chunk(3, "CONTINUE", "", "[\"세 번째\"]"))).isPresent();
        assertThat(noteService.find(session).topics()).contains("두 번째").contains("세 번째");
    }

    @Test
    void completion_waits_until_no_chunk_is_missing() {
        accumulator.append(chunk(1, "START_NEW", "필터 체인", "[\"첫 요점\"]"));

        // 완료가 3을 가리키는데 우리는 1까지만 반영했다 — 확정하면 그 구멍이 영구히 남는다.
        LectureNoteEvent.CaptureCompleted early = new LectureNoteEvent.CaptureCompleted(
                "evt-c1", session, lesson, 3, 30, "ROOM_DELETED");
        assertThat(accumulator.complete(early)).isEmpty();
        assertThat(noteService.find(session).status()).isEqualTo("CAPTURING");

        accumulator.append(chunk(2, "CONTINUE", "", "[\"둘\"]"));
        accumulator.append(chunk(3, "CONTINUE", "", "[\"셋\"]"));
        assertThat(accumulator.complete(early)).isPresent();
        assertThat(noteService.find(session).status()).isEqualTo("COMPLETED");

        // 완료 재전송은 무시한다.
        assertThat(accumulator.complete(early)).isEmpty();
    }

    @Test
    void refined_snapshot_replaces_the_note_only_after_completion() {
        accumulator.append(chunk(1, "START_NEW", "필터 체인", "[\"첫 요점\"]"));
        LectureNoteEvent.RefinedSnapshot refined = new LectureNoteEvent.RefinedSnapshot(
                "evt-r1", session, lesson, 1,
                "[{\"topicId\":\"t1\",\"title\":\"정리된 제목\",\"keyPoints\":[\"정리된 요점\"]}]",
                "## 정리된 제목\n- 정리된 요점");

        // 아직 자라는 중인 노트를 정제본이 덮으면 안 된다.
        assertThat(accumulator.refine(refined)).isEmpty();
        assertThat(noteService.find(session).topics()).contains("필터 체인");

        accumulator.complete(new LectureNoteEvent.CaptureCompleted("evt-c1", session, lesson, 1, 10, "ROOM_DELETED"));
        assertThat(accumulator.refine(refined)).isPresent();

        // 덧붙이는 값이 아니라 교체하는 값이다.
        assertThat(noteService.find(session).topics()).contains("정리된 제목").doesNotContain("필터 체인");
        assertThat(noteService.find(session).status()).isEqualTo("REFINED");
    }

    @Test
    void a_refined_snapshot_from_a_stale_input_is_not_applied() {
        accumulator.append(chunk(1, "START_NEW", "필터 체인", "[\"첫 요점\"]"));
        accumulator.append(chunk(2, "CONTINUE", "", "[\"둘\"]"));
        accumulator.complete(new LectureNoteEvent.CaptureCompleted("evt-c1", session, lesson, 2, 20, "ROOM_DELETED"));

        // 조각 1까지만 보고 만든 정제본 — 2가 빠진 결과로 덮으면 안 된다.
        LectureNoteEvent.RefinedSnapshot stale = new LectureNoteEvent.RefinedSnapshot(
                "evt-r1", session, lesson, 1, "[{\"title\":\"낡은 정리\",\"keyPoints\":[]}]", "## 낡은 정리");
        assertThat(accumulator.refine(stale)).isEmpty();
        assertThat(noteService.find(session).topics()).contains("필터 체인");
    }

    @Test
    void markdown_is_joined_the_way_the_contract_says() {
        accumulator.append(chunk(1, "START_NEW", "첫 주제", "[\"a\"]"));
        accumulator.append(chunk(2, "CONTINUE", "", "[\"b\"]"));
        accumulator.append(chunk(3, "START_NEW", "둘째 주제", "[\"c\"]"));

        String markdown = noteService.find(session).markdown();
        // 첫 조각은 그대로, CONTINUE 앞에는 줄바꿈 하나, START_NEW 앞에는 빈 줄 하나.
        assertThat(markdown).startsWith("## 첫 주제");
        assertThat(markdown).contains("- 요점\n- 요점");
        assertThat(markdown).contains("\n\n## 둘째 주제");
    }

    @Test
    void a_broken_key_points_payload_does_not_stop_consumption() {
        // 형식이 어긋난 요점을 통째로 한 항목으로 넣지 않고 건너뛴다 — 노트 하나 때문에 소비가 멈추면 안 된다.
        assertThat(accumulator.append(chunk(1, "START_NEW", "제목", "요점인데 배열이 아님"))).isPresent();
        assertThat(noteService.find(session).topics()).contains("제목").doesNotContain("배열이 아님");
    }
}
