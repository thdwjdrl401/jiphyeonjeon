package com.liveclass.learning.repository;

import com.liveclass.learning.domain.LearningProgress;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface LearningProgressRepository extends JpaRepository<LearningProgress, Long> {

    /** upsert의 기준 — 사용자·레슨당 진도 한 행(uq_learning_progress(user_id, lesson_id)). */
    Optional<LearningProgress> findByUserIdAndLessonId(UUID userId, UUID lessonId);

    /** 카탈로그 progress 집계용 배치 조회(N+1 방지). */
    List<LearningProgress> findByUserIdAndLessonIdIn(UUID userId, Collection<UUID> lessonIds);

    /**
     * 쌓인 시청 칸을 진도로 환산한다(ADR-0117). 녹화가 준비돼 <b>분모(전체 칸 수)가 처음 생기는</b>
     * 순간에 한 번 돈다.
     *
     * <p>라이브 중에는 진도가 나가지 않는다 — 화면이 비율을 내려면 전체 길이가 필요한데 그 값이
     * 없기 때문이다. 예전에는 그 환산이 <b>학생이 다시보기를 열 때</b>만 일어나서, 끝까지 듣고도
     * 열지 않으면 0%로 남았다. 녹화가 없는 강의에서는 영영 0%였다.
     *
     * <p><b>진도는 내려가지 않는다</b>(ADR-0116) — {@code GREATEST}로 기존 값을 지킨다. 다시 돌려도
     * 결과가 같아(멱등) 재처리·재시도가 안전하다.
     *
     * <p>{@code last_position_ms}는 손대지 않는다. 라이브로 들은 사람에게 "이어볼 위치"란 것이 없고,
     * 이미 있는 값을 0으로 되돌리면 이어보기가 망가진다. 새로 만드는 행만 기본값 0으로 들어간다.
     */
    /*
     * 네이티브 쓰기는 영속성 컨텍스트를 건너뛴다. 비워 주지 않으면 같은 트랜잭션에서 이미 읽어 둔
     * 진도 엔티티가 <b>옛 값 그대로</b> 남아, 방금 올린 진도가 화면에 반영되지 않는다.
     * flush는 그 반대 방향이다 — 아직 안 나간 변경이 이 쿼리보다 늦게 도착하면 서로를 덮는다.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = """
            INSERT INTO core.learning_progress (user_id, lesson_id, progress_percent, completed_at)
            SELECT w.user_id,
                   :lessonId,
                   LEAST(100, ROUND(COUNT(*) * 100.0 / :totalBuckets)),
                   CASE WHEN ROUND(COUNT(*) * 100.0 / :totalBuckets) >= :completionThreshold
                        THEN now() END
            FROM core.watch_bucket w
            WHERE w.lesson_id = :lessonId
            GROUP BY w.user_id
            ON CONFLICT (user_id, lesson_id) DO UPDATE
            SET progress_percent = GREATEST(core.learning_progress.progress_percent,
                                            EXCLUDED.progress_percent),
                completed_at = COALESCE(core.learning_progress.completed_at, EXCLUDED.completed_at),
                updated_at = now()
            """, nativeQuery = true)
    int settleProgressFromWatchBuckets(@Param("lessonId") UUID lessonId,
                                       @Param("totalBuckets") int totalBuckets,
                                       @Param("completionThreshold") int completionThreshold);
}
