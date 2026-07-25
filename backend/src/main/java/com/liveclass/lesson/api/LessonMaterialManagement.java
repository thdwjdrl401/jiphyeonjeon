package com.liveclass.lesson.api;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 레슨 자료(MATERIAL) 연결 포트. 소유권·인가는 호출하는 쪽(curriculum)이 책임지고, 이 포트는
 * 에셋 유효성 검증(kind=MATERIAL·업로드 완료·업로더)과 연결 레코드 저장·조회만 한다 —
 * lesson 모듈은 curriculum에 의존하지 않는다(순환 금지). asset은 asset.api 포트로만 참조한다.
 */
public interface LessonMaterialManagement {

    /**
     * 레슨에 자료 에셋을 연결한다(status=ACTIVE 저장). requesterId는 에셋 업로더 검증에만 쓴다 —
     * 레슨 소유권은 호출자가 이미 확인했다. 같은 (lessonId, assetId) 활성 연결이 이미 있으면 충돌.
     */
    MaterialView attach(UUID lessonId, UUID assetId, UUID requesterId);

    /** 레슨의 활성(ACTIVE) 자료 목록을 생성순으로. */
    List<MaterialView> findActiveByLesson(UUID lessonId);

    /**
     * 여러 레슨의 활성 자료를 한 번에 조회한다(N+1 방지). 커리큘럼 상세처럼 목차 전체의 자료를
     * 채울 때 쓴다. 자료가 없는 레슨은 맵에 담기지 않는다.
     */
    Map<UUID, List<MaterialView>> findActiveByLessons(Collection<UUID> lessonIds);
}
