package com.liveclass.curriculum.repository;

import com.liveclass.curriculum.domain.Curriculum;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface CurriculumRepository extends JpaRepository<Curriculum, UUID> {

    List<Curriculum> findByInstructorIdOrderByCreatedAtDesc(UUID instructorId);
}
