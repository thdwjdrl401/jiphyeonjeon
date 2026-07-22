package com.liveclass.video.api;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * 다시보기 조회 포트(읽기). 소유권·인가는 호출자가 책임지고 이 포트는 데이터만 다룬다.
 */
public interface ReplayDirectory {

    /**
     * 레슨들의 녹화본을 한 번에 가져온다. 녹화가 없는 레슨은 결과에 포함되지 않는다.
     * 목차처럼 레슨이 여러 개인 화면에서 레슨마다 조회하면 N+1이라 배치 조회를 포트에 둔다.
     */
    List<ReplayView> findByLessons(Collection<UUID> lessonIds);
}
