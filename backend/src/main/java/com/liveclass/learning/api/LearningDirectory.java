package com.liveclass.learning.api;

import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * 학습 진도 조회 포트. curriculum이 카탈로그의 progress(내 수강 목록·상세)를 채울 때 쓴다.
 * 다른 모듈은 learning의 엔티티·리포지토리에 접근하지 않고 이 포트만 쓴다(모듈 경계).
 */
public interface LearningDirectory {

    /**
     * 사용자의 여러 레슨 진도를 <b>한 번에</b> 조회한다(N+1 방지). 진도 기록이 없는 레슨은 결과에
     * 담기지 않는다 — 호출자가 "전체 레슨 수" 대비로 완료율을 계산한다.
     */
    List<LearningProgressView> findProgress(UUID userId, Collection<UUID> lessonIds);

    /**
     * 이 레슨의 다시보기를 <b>방금까지 보고 있던</b> 사람들. 운영 콘솔이 "지금 누가 무엇을 보는가"를
     * 답하는 근거다.
     *
     * <p><b>판정은 {@code watch_bucket.updated_at}으로 한다.</b> 그 컬럼은 클라이언트가 시청을 보고할
     * 때만, 그것도 서버 시각으로 갱신된다. {@code learning_progress.updated_at}은 쓸 수 없다 — 녹화가
     * 준비되는 순간 도는 진도 환산 배치(ADR-0117)가 그 레슨의 <b>모든</b> 시청자 행을 한꺼번에
     * 갱신하므로, 몇 달 전에 보고 만 사람까지 "지금 보는 중"으로 올라온다.
     *
     * <p>보고 주기는 15초다. 일시정지하거나 탭을 닫으면 보고가 끊겨 창을 벗어나며 목록에서 빠진다 —
     * 그것이 의도한 동작이다("재생 중인 사람"을 묻는 것이므로).
     *
     * <p>강사 본인의 재생은 애초에 기록되지 않아 여기 잡히지 않는다(재시청 그래프 오염 방지).
     *
     * @param since 이 시각 이후로 보고가 있었던 사람만. 호출자가 "최근"의 길이를 정한다
     * @return 마지막 보고가 최근인 사람이 앞. 아무도 없으면 빈 목록
     */
    List<RecentWatcherView> findRecentWatchers(UUID lessonId, OffsetDateTime since);
}
