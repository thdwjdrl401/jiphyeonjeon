package com.liveclass.lesson.api;

import java.util.List;
import java.util.UUID;

/**
 * 커리큘럼-레벨 자료(MATERIAL) 연결 포트(ADR-0042). 레슨 자료({@link LessonMaterialManagement})와 대칭이며
 * 같은 {@code material_asset} 테이블을 스코프만 달리해 재사용한다. 소유권·인가는 호출하는 쪽(curriculum)이
 * 책임지고, 이 포트는 에셋 유효성 검증(kind=MATERIAL·업로드 완료·업로더)과 연결 레코드 저장·조회만 한다.
 *
 * <p>자료 데이터가 lesson 모듈에 있는 이유: {@code material_asset}(엔티티·리포)의 소유 모듈이 lesson이라,
 * 커리큘럼 스코프 행도 같은 소유자가 관리한다(모듈 경계 — curriculum→lesson.api 단방향 의존 유지).
 */
public interface CurriculumMaterialManagement {

    /**
     * 커리큘럼에 자료 에셋을 연결한다(status=ACTIVE 저장, scope=curriculum). requesterId는 에셋 업로더
     * 검증에만 쓴다 — 커리큘럼 소유권은 호출자가 이미 확인했다. 같은 (curriculumId, assetId) 활성 연결이
     * 이미 있으면 충돌({@link MaterialAlreadyAttachedException}).
     */
    MaterialView attach(UUID curriculumId, UUID assetId, UUID requesterId);

    /** 커리큘럼의 활성(ACTIVE) 자료 목록을 생성순으로. */
    List<MaterialView> findActiveByCurriculum(UUID curriculumId);

    /**
     * 커리큘럼 자료 연결을 해제한다(소프트 삭제 → status DELETED). 멱등: 그 커리큘럼의 활성 연결이
     * 아니면(없음·이미 삭제·다른 커리큘럼) 아무것도 하지 않는다. 소유권은 호출자가 확인.
     */
    void detach(UUID curriculumId, UUID materialId);

    /**
     * 자료 임베딩 상태를 갱신한다(ADR-0036) — AI 콜백/파이프라인이 옮긴다. materialId 기준이라 스코프와
     * 무관하다. {@code embeddingStatus}는 {@code MaterialEmbeddingStatus} 이름. 없는 materialId면 무시.
     */
    void updateEmbeddingStatus(UUID materialId, String embeddingStatus);
}
