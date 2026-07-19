package com.liveclass.curriculum.repository;

import com.liveclass.curriculum.domain.Curriculum;
import com.liveclass.curriculum.domain.CurriculumLifecycleStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface CurriculumRepository extends JpaRepository<Curriculum, UUID> {

    List<Curriculum> findByInstructorIdOrderByCreatedAtDesc(UUID instructorId);

    Optional<Curriculum> findByIdAndLifecycleStatus(UUID id, CurriculumLifecycleStatus status);

    Page<Curriculum> findByLifecycleStatus(CurriculumLifecycleStatus status, Pageable pageable);

    /**
     * 공개 목록 검색. 제목·짧은 소개를 대소문자 무시 부분 검색한다.
     * q가 없을 때는 findByLifecycleStatus를 쓴다 — null 파라미터를 CONCAT에 넣으면
     * Postgres가 타입을 bytea로 추론해 실패하므로 쿼리를 분리한다.
     */
    @Query("""
            SELECT c FROM Curriculum c
            WHERE c.lifecycleStatus = :status
              AND (LOWER(c.title) LIKE LOWER(CONCAT('%', :q, '%'))
                   OR LOWER(c.summary) LIKE LOWER(CONCAT('%', :q, '%')))
            """)
    Page<Curriculum> searchPublic(@Param("status") CurriculumLifecycleStatus status,
                                  @Param("q") String q,
                                  Pageable pageable);
}
