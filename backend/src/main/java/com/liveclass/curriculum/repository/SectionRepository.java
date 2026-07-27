package com.liveclass.curriculum.repository;

import com.liveclass.curriculum.domain.Section;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface SectionRepository extends JpaRepository<Section, UUID> {

    List<Section> findByCurriculumIdOrderByOrderIndexAsc(UUID curriculumId);

    /** 여러 커리큘럼의 섹션을 한 번에(내 수강 목록 진도 집계용, N+1 방지). */
    List<Section> findByCurriculumIdIn(Collection<UUID> curriculumIds);

    Optional<Section> findTopByCurriculumIdOrderByOrderIndexDesc(UUID curriculumId);

    long countByCurriculumId(UUID curriculumId);
}
