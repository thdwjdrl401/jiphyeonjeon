package com.liveclass.lesson.repository;

import com.liveclass.lesson.domain.MaterialAsset;
import com.liveclass.lesson.domain.MaterialStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface MaterialAssetRepository extends JpaRepository<MaterialAsset, UUID> {

    /** 레슨의 특정 상태 자료를 생성순으로 — 레슨 상세의 materials 채우기용. */
    List<MaterialAsset> findByLessonIdAndStatusOrderByCreatedAtAsc(UUID lessonId, MaterialStatus status);

    /** 여러 레슨의 특정 상태 자료를 한 번에(N+1 방지) — 커리큘럼 상세 등 목록 응답용. */
    List<MaterialAsset> findByLessonIdInAndStatusOrderByCreatedAtAsc(Collection<UUID> lessonIds, MaterialStatus status);

    /** 같은 (레슨, 에셋) 중복 연결 판정 — DDL에 유니크 제약이 없어 앱에서 막는다. */
    boolean existsByLessonIdAndAssetIdAndStatus(UUID lessonId, UUID assetId, MaterialStatus status);
}
