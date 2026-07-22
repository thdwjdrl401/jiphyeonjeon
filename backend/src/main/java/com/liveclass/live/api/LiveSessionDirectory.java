package com.liveclass.live.api;

import java.util.Collection;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * 라이브 세션 조회 포트(읽기). 쓰기는 {@link LiveSessionManagement}가 담당한다 —
 * 다른 모듈과 동일하게 Directory(읽기)/Management(쓰기)로 나눈다.
 * 소유권·인가는 호출자가 책임지고 이 포트는 데이터만 다룬다.
 */
public interface LiveSessionDirectory {

    Optional<LiveSessionView> findById(UUID sessionId);

    boolean existsForLesson(UUID lessonId);

    /**
     * 커리큘럼별 "가장 가까운 예정 세션"을 <b>한 번에</b> 조회한다(목록 화면의 다음 일정).
     * 커리큘럼 목록 한 페이지를 통째로 넘겨 한 쿼리로 해결하기 위한 배치 포트다 — 행마다 호출하면 N+1이다.
     *
     * <p>"다음"은 <b>앞으로 있을 것 또는 지금 진행 중인 것</b>을 뜻한다. 일정(scheduledAt)이 있고,
     * ENDING·ENDED·CANCELLED·FAILED가 아니며, scheduledAt이 아직 지나지 않았거나(미래) 이미 지났더라도
     * 진행 계열(OPEN/STARTING/LIVE)인 세션 중 scheduledAt이 가장 이른 것을 돌려준다.
     * 시작하지 않은 채 방치된 과거 SCHEDULED 세션은 대상이 아니다(진짜 다음 일정을 가리지 않도록).
     * 해당하는 세션이 없는 커리큘럼은 맵에 키 자체가 없다.
     */
    Map<UUID, LiveSessionView> nextScheduledByCurriculum(Collection<UUID> curriculumIds);
}
