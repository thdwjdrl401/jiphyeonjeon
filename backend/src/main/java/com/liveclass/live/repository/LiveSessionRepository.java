package com.liveclass.live.repository;

import com.liveclass.live.domain.LiveSession;
import com.liveclass.live.domain.LiveSessionStatus;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface LiveSessionRepository extends JpaRepository<LiveSession, UUID> {

    boolean existsByLessonId(UUID lessonId);

    Optional<LiveSession> findByLessonId(UUID lessonId);

    /** 동시 /start가 둘 다 active attempt를 만들지 않게 세션 행을 잠근다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from LiveSession s where s.id = :sessionId")
    Optional<LiveSession> findByIdForUpdate(@Param("sessionId") UUID sessionId);

    /**
     * 여러 커리큘럼의 "앞으로 있을(또는 지금 진행 중인) 세션"을 <b>한 번의 쿼리로</b> 가져온다(목록 N+1 방지).
     * live_session에 curriculum_id가 비정규화돼 있어 curriculum 모듈과 조인하지 않아도 된다.
     *
     * <p>대상 조건은 세 가지다.
     * <ul>
     *   <li>일정이 없는 DRAFT 세션(scheduled_at NULL)은 제외 — 아직 "다음 일정"이 아니다.</li>
     *   <li>제외 상태(ENDED/CANCELLED/FAILED + 정리 중인 ENDING)는 제외 — 다시 열리지 않는다.</li>
     *   <li><b>scheduled_at &gt;= now</b>이거나, 지났더라도 진행 계열(OPEN/STARTING/LIVE)이면 포함.
     *       시작하지 않은 채 방치돼 영영 SCHEDULED로 남은 과거 세션이 "다음 일정" 자리를 차지하고
     *       진짜 다음 일정을 가리는 것을 막으면서, 10분 전에 시작해 지금 켜져 있는 세션은 계속 보여준다.</li>
     * </ul>
     *
     * <p>{@code now}는 DB 함수가 아니라 호출자가 넘긴다 — 테스트에서 시각을 고정할 수 있어야 한다.
     * scheduledAt 오름차순(동률은 id)으로 돌려주므로 호출자가 커리큘럼별 첫 행만 취하면 "가장 가까운 일정"이 된다
     * (커리큘럼당 세션 수는 레슨 수 이하라 윈도우 함수 없이도 충분하다).
     */
    @Query("""
            SELECT s FROM LiveSession s
            WHERE s.curriculumId IN :curriculumIds
              AND s.scheduledAt IS NOT NULL
              AND s.status NOT IN :excludedStatuses
              AND (s.scheduledAt >= :now OR s.status IN :inProgressStatuses)
            ORDER BY s.scheduledAt ASC, s.id ASC
            """)
    List<LiveSession> findUpcomingByCurriculumIds(@Param("curriculumIds") Collection<UUID> curriculumIds,
                                                  @Param("excludedStatuses") Collection<LiveSessionStatus> excludedStatuses,
                                                  @Param("inProgressStatuses") Collection<LiveSessionStatus> inProgressStatuses,
                                                  @Param("now") OffsetDateTime now);
    List<LiveSession> findByLessonIdIn(Collection<UUID> lessonIds);

    /** 이 강사가 소유한 세션 중 주어진 상태의 것이 하나라도 있는가(탈퇴 가드용). */
    boolean existsByInstructorIdAndStatusIn(UUID instructorId, Collection<LiveSessionStatus> statuses);
}
