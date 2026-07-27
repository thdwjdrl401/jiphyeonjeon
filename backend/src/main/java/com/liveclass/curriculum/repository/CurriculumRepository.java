package com.liveclass.curriculum.repository;

import com.liveclass.curriculum.domain.Curriculum;
import com.liveclass.curriculum.domain.CurriculumLifecycleStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

public interface CurriculumRepository extends JpaRepository<Curriculum, UUID> {

    /*
     * 강사 운영 목록(MY-CURRICULUM-02). 소유자 한정 + 선택적 제목검색·상태필터의 4가지 조합을
     * 파생 쿼리로 나눈다. "q/status가 null이면 무시"를 한 JPQL에 넣으면 Postgres가 바인딩 타입을
     * 추론하지 못해 깨지므로(searchPublic 주석 참고) 조합별 메서드로 분리했다.
     * TitleContainingIgnoreCase는 와일드카드를 바인딩 값에 붙여 CONCAT 타입추론 문제를 피한다.
     */

    Page<Curriculum> findByInstructorId(UUID instructorId, Pageable pageable);

    /** 강사의 모든 커리큘럼(비페이지). 대시보드 합계 집계용 — 상태 무관 전체를 센다. */
    java.util.List<Curriculum> findByInstructorId(UUID instructorId);

    Page<Curriculum> findByInstructorIdAndLifecycleStatus(UUID instructorId,
                                                          CurriculumLifecycleStatus lifecycleStatus,
                                                          Pageable pageable);

    Page<Curriculum> findByInstructorIdAndTitleContainingIgnoreCase(UUID instructorId, String title,
                                                                    Pageable pageable);

    Page<Curriculum> findByInstructorIdAndLifecycleStatusAndTitleContainingIgnoreCase(
            UUID instructorId, CurriculumLifecycleStatus lifecycleStatus, String title, Pageable pageable);

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

    /**
     * 구조 변경 시 structure_version 원자 증가. 엔티티를 읽어 +1 해서 쓰면(read-modify-write)
     * 동시 요청에서 증분이 유실되므로 DB에서 컬럼 기준으로 올린다.
     *
     * <p>flushAutomatically: 벌크 UPDATE 전에 대기 중인 INSERT/UPDATE/DELETE를 먼저 내보내
     * 트리거(section_count 등)와 순서가 어긋나지 않게 한다.
     * clearAutomatically: 벌크 UPDATE는 1차 캐시를 우회하므로, 이후 조회가 낡은 structure_version을
     * 들고 있는 엔티티를 다시 쓰지 않도록 영속성 컨텍스트를 비운다.
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update Curriculum c set c.structureVersion = c.structureVersion + 1 where c.id = :id")
    int bumpStructureVersion(@Param("id") UUID id);

    /**
     * 구조 순서 저장(STRUCTURE-01)용 compare-and-set. 호출자가 본 baseVersion과 DB 값이 같을 때만
     * +1 하고 1을 돌려준다. 0이면 그 사이 다른 요청이 구조를 바꾼 것 → 409로 충돌을 알린다.
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update Curriculum c set c.structureVersion = c.structureVersion + 1 "
            + "where c.id = :id and c.structureVersion = :expected")
    int bumpStructureVersionIfMatches(@Param("id") UUID id, @Param("expected") int expected);
}
