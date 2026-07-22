package com.liveclass.live.api;

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
}
