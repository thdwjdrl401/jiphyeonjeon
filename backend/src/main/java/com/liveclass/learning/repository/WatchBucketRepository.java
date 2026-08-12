package com.liveclass.learning.repository;

import com.liveclass.learning.domain.WatchBucket;
import com.liveclass.learning.domain.WatchBucketId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public interface WatchBucketRepository extends JpaRepository<WatchBucket, WatchBucketId> {

    /**
     * 누적 절대값으로 올린다. <b>더한 값이 아니라 큰 값을 남긴다</b> — 클라이언트가 자기 누적치를
     * 통째로 보내므로, 재전송·중복 전송이 횟수를 부풀리지 않는다(delta 방식이면 재시도마다 늘어난다).
     */
    @Modifying
    @Query(value = """
            INSERT INTO core.watch_bucket (lesson_id, user_id, bucket_index, play_count, updated_at)
            VALUES (:lessonId, :userId, :bucketIndex, :playCount, now())
            ON CONFLICT (lesson_id, user_id, bucket_index)
            DO UPDATE SET play_count = GREATEST(core.watch_bucket.play_count, EXCLUDED.play_count),
                          updated_at = now()
            """, nativeQuery = true)
    void upsert(@Param("lessonId") UUID lessonId, @Param("userId") UUID userId,
                @Param("bucketIndex") int bucketIndex, @Param("playCount") int playCount);

    /** 새로고침 뒤 이어서 세려면 내가 이미 쌓은 값을 알아야 한다. */
    List<WatchBucket> findByLessonIdAndUserId(UUID lessonId, UUID userId);

    /**
     * 칸별 집계. {@code plays}는 재생 횟수 합, {@code viewers}는 <b>그 칸에 도달한 사람 수</b>다.
     *
     * <p>강도를 {@code plays / viewers}로 만드는 이유: 절대 합을 그리면 뒤로 갈수록 이탈자가 늘어
     * 재시청과 무관하게 우하향 그래프가 나오고, 강사가 "앞부분이 어려웠구나"로 오해한다.
     *
     * <p>강사 본인의 재생은 애초에 기록하지 않으므로 여기서 걸러낼 것이 없다 — 검수하며 되감은 것이
     * 학생 재시청으로 잡히면 그래프가 오염된다.
     */
    @Query(value = """
            SELECT bucket_index AS bucketIndex,
                   SUM(play_count) AS plays,
                   COUNT(*) AS viewers
            FROM core.watch_bucket
            WHERE lesson_id = :lessonId
            GROUP BY bucket_index
            ORDER BY bucket_index
            """, nativeQuery = true)
    List<BucketAggregate> aggregate(@Param("lessonId") UUID lessonId);

    /**
     * 방금까지 이 레슨을 보고 있던 사람들(운영 콘솔).
     *
     * <p><b>{@code watch_bucket.updated_at}으로 판정하는 이유</b>: 이 컬럼은 클라이언트가 시청을
     * 보고할 때만, 그것도 {@code now()}(서버 시각)로 갱신된다. {@code learning_progress.updated_at}은
     * 진도 환산 배치(ADR-0117)가 레슨의 모든 시청자 행을 한꺼번에 건드리므로 "지금 보는 중"의
     * 근거가 될 수 없다.
     *
     * <p>위치는 {@code learning_progress}에서 가져온다 — 같은 15초 주기에 함께 올라오는 값이고,
     * 칸 번호의 최댓값은 <b>가장 멀리 간 지점</b>이라 현재 위치가 아니다. 진도 기록이 아직 없으면
     * ({@code LEFT JOIN}) 0으로 둔다. 레슨·사용자당 진도는 한 행이라 {@code MAX}는 그 한 행이다.
     */
    @Query(value = """
            SELECT w.user_id AS userId,
                   MAX(w.updated_at) AS lastReportedAt,
                   COALESCE(MAX(p.last_position_ms), 0) AS lastPositionMs,
                   COALESCE(MAX(p.progress_percent), 0) AS progressPercent
            FROM core.watch_bucket w
            LEFT JOIN core.learning_progress p
                   ON p.user_id = w.user_id AND p.lesson_id = w.lesson_id
            WHERE w.lesson_id = :lessonId AND w.updated_at >= :since
            GROUP BY w.user_id
            ORDER BY MAX(w.updated_at) DESC
            """, nativeQuery = true)
    List<RecentWatcher> findRecentWatchers(@Param("lessonId") UUID lessonId,
                                           @Param("since") OffsetDateTime since);

    /**
     * 최근 시청자 한 줄.
     *
     * <p>시각을 {@code Instant}로 받는다 — 네이티브 쿼리의 {@code timestamptz}는 그 타입으로 오고,
     * 프로젝션은 {@code OffsetDateTime}으로 변환해 주지 않는다(변환기 없이 실패한다). 표시용 오프셋은
     * 경계 DTO를 만들 때 붙인다.
     */
    interface RecentWatcher {
        UUID getUserId();

        Instant getLastReportedAt();

        long getLastPositionMs();

        int getProgressPercent();
    }

    /** 칸 하나의 집계 한 줄. */
    interface BucketAggregate {
        int getBucketIndex();

        long getPlays();

        long getViewers();
    }
}
