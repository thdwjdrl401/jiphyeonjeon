package com.liveclass.curriculum.repository;

import com.liveclass.curriculum.domain.Section;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface SectionRepository extends JpaRepository<Section, UUID> {

    List<Section> findByCurriculumIdOrderByOrderIndexAsc(UUID curriculumId);

    Optional<Section> findTopByCurriculumIdOrderByOrderIndexDesc(UUID curriculumId);

    long countByCurriculumId(UUID curriculumId);
}
