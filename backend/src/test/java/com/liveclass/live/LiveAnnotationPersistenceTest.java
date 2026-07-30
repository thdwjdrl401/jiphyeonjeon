package com.liveclass.live;

import com.liveclass.live.repository.LiveAnnotationOpRepository;
import com.liveclass.live.service.LiveAnnotationService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 판서 영속화 계약(ADR-0051, CONTRACT §3-6b).
 *
 * <p>저장이 필요한 이유는 둘이다. 강사가 새로고침해도 판서가 남아야 하고, 각 op에 세션 상대 시각이
 * 붙어 나중에 "강사가 이걸 강조한 순간"으로 다시보기를 이동할 수 있어야 한다. 여기서는 그 둘을 떠받치는
 * 두 가지를 고정한다 — <b>문서 복원</b>과 <b>revision이 역행하지 않는 것</b>.
 */
@SpringBootTest
@Transactional
class LiveAnnotationPersistenceTest {

    @Autowired
    private LiveAnnotationService annotationService;

    @Autowired
    private LiveAnnotationOpRepository repository;

    @Autowired
    private JdbcTemplate jdbc;

    private static final OffsetDateTime AT = OffsetDateTime.parse("2026-07-30T10:00:00Z");

    /**
     * op는 실재하는 세션에만 매달린다(FK). 세션이 지워지면 그 판서도 함께 지워져야 하므로 이 제약은
     * 설계의 일부다 — 그래서 테스트도 랜덤 UUID가 아니라 실제 세션을 만들어 쓴다.
     */
    private UUID newSession() {
        UUID instructorId = UUID.randomUUID();
        UUID curriculumId = UUID.randomUUID();
        UUID sectionId = UUID.randomUUID();
        UUID lessonId = UUID.randomUUID();
        UUID sessionId = UUID.randomUUID();

        jdbc.update("insert into core.app_user (id, email, password_hash, display_name, role, status) "
                        + "values (?, ?, 'x', '강사', 'INSTRUCTOR', 'ACTIVE')",
                instructorId, "annotation-" + instructorId + "@test.local");
        jdbc.update("insert into core.curriculum (id, instructor_id, title) values (?, ?, '판서')",
                curriculumId, instructorId);
        jdbc.update("insert into core.section (id, curriculum_id, title, order_index) values (?, ?, 's', 1)",
                sectionId, curriculumId);
        jdbc.update("insert into core.lesson (id, section_id, title, order_index) values (?, ?, 'l', 1)",
                lessonId, sectionId);
        jdbc.update("insert into core.live_session (id, lesson_id, curriculum_id, instructor_id, status) "
                        + "values (?, ?, ?, ?, 'LIVE')",
                sessionId, lessonId, curriculumId, instructorId);
        return sessionId;
    }

    @Test
    void 같은_revision이_다시_와도_한_번만_적재한다() {
        UUID sessionId = newSession();

        assertThat(annotationService.append(sessionId, 1, "upsert", "{\"elements\":[]}", AT)).isTrue();
        assertThat(annotationService.append(sessionId, 1, "upsert", "{\"elements\":[]}", AT)).isFalse();

        assertThat(repository.countBySessionId(sessionId)).isEqualTo(1);
    }

    /**
     * 세션 전체를 접으면 강의가 길어질수록 느려진다. 스냅샷은 그 자체로 전체 상태라 그 이전 op는
     * 볼 필요가 없다.
     */
    @Test
    void 복원은_마지막_스냅샷과_그_이후_op만_돌려준다() {
        UUID sessionId = newSession();
        annotationService.append(sessionId, 1, "upsert", "{\"n\":1}", AT);
        annotationService.append(sessionId, 2, "snapshot", "{\"n\":2}", AT);
        annotationService.append(sessionId, 3, "upsert", "{\"n\":3}", AT);
        annotationService.append(sessionId, 4, "delete", "{\"n\":4}", AT);

        LiveAnnotationService.AnnotationDocumentView view = annotationService.restore(sessionId);

        assertThat(view.snapshotPayload()).isEqualTo("{\"n\":2}");
        assertThat(view.ops()).extracting(LiveAnnotationService.OpView::revision).containsExactly(3L, 4L);
        assertThat(view.revision()).isEqualTo(4);
    }

    @Test
    void 스냅샷이_없으면_처음부터_전부_돌려준다() {
        UUID sessionId = newSession();
        annotationService.append(sessionId, 1, "upsert", "{\"n\":1}", AT);
        annotationService.append(sessionId, 2, "upsert", "{\"n\":2}", AT);

        LiveAnnotationService.AnnotationDocumentView view = annotationService.restore(sessionId);

        assertThat(view.snapshotPayload()).isNull();
        assertThat(view.ops()).hasSize(2);
    }

    @Test
    void 저장된_것이_없으면_빈_문서다() {
        LiveAnnotationService.AnnotationDocumentView view = annotationService.restore(UUID.randomUUID());

        assertThat(view.revision()).isZero();
        assertThat(view.snapshotPayload()).isNull();
        assertThat(view.ops()).isEmpty();
    }

    /**
     * 강사가 새로고침하면 브라우저의 카운터가 0으로 돌아간다. 그대로 이어 쓰면 새로 그린 획이 수신
     * 측에서 "이미 본 op"로 버려져 <b>수강생에게 영영 나타나지 않는다</b> — 강사 화면에는 그려지므로
     * 눈치채기 어렵다. 서버가 이어갈 번호를 알려 주는 것이 그 역행을 막는 유일한 장치다.
     */
    @Test
    void 이어서_채번할_번호를_알려준다() {
        UUID sessionId = newSession();
        assertThat(annotationService.nextRevision(sessionId)).isEqualTo(1);

        annotationService.append(sessionId, 1, "upsert", "{}", AT);
        annotationService.append(sessionId, 47, "upsert", "{}", AT);

        assertThat(annotationService.nextRevision(sessionId)).isEqualTo(48);
    }

    /** 저장 실패가 강의를 막으면 안 된다 — 라이브 전달은 이미 끝난 뒤의 기록이다. */
    @Test
    void 적재가_실패해도_예외를_밖으로_던지지_않는다() {
        UUID sessionId = newSession();

        // payload가 null이면 not-null 제약에 걸린다. 그래도 호출자에게 예외가 나가지 않아야 한다.
        annotationService.appendQuietly(sessionId, 1, "upsert", null, AT);
    }
}
