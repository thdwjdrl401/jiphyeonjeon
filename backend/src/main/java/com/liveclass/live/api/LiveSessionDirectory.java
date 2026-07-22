package com.liveclass.live.api;

import java.util.Collection;
import java.util.List;
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
     * 레슨들에 걸린 라이브 세션을 한 번에 가져온다(레슨당 최대 하나).
     * 목차처럼 레슨이 여러 개인 화면에서 레슨마다 조회하면 N+1이라 배치 조회를 포트에 둔다.
     */
    List<LiveSessionView> findByLessons(Collection<UUID> lessonIds);
}
