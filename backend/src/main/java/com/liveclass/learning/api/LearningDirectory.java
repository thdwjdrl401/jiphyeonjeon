package com.liveclass.learning.api;

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
}
