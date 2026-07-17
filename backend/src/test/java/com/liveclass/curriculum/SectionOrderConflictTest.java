package com.liveclass.curriculum;

import com.liveclass.auth.domain.AccountStatus;
import com.liveclass.auth.domain.AppUser;
import com.liveclass.auth.domain.Role;
import com.liveclass.auth.repository.AppUserRepository;
import com.liveclass.curriculum.domain.Curriculum;
import com.liveclass.curriculum.domain.CurriculumLifecycleStatus;
import com.liveclass.curriculum.domain.EnrollmentType;
import com.liveclass.curriculum.domain.Section;
import com.liveclass.curriculum.repository.CurriculumRepository;
import com.liveclass.curriculum.repository.SectionRepository;
import com.liveclass.curriculum.web.CurriculumExceptionHandler;
import com.liveclass.common.web.ErrorResponse;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * uq_section_order(curriculum_id, order_index) 충돌 → 409 매핑 검증.
 *
 * 제약이 DEFERRABLE이라 위반은 커밋 시점에 터진다 — @Transactional 테스트(롤백)로는 재현이 안 되므로
 * 두 섹션을 실제로 커밋해 예외 타입을 확인하고, 핸들러가 그 타입을 409로 내리는지 따로 검증한다.
 */
@SpringBootTest
class SectionOrderConflictTest {

    @Autowired private AppUserRepository appUserRepository;
    @Autowired private CurriculumRepository curriculumRepository;
    @Autowired private SectionRepository sectionRepository;

    /** 실제 DB: 같은 order_index 두 섹션을 커밋하면 DataIntegrityViolationException이 올라온다. */
    @Test
    void duplicate_order_index_raises_data_integrity_violation() {
        UUID instructorId = seedInstructor();
        UUID curriculumId = seedCurriculum(instructorId);
        try {
            commitSection(curriculumId, 0);
            assertThatThrownBy(() -> commitSection(curriculumId, 0))
                    .isInstanceOf(DataIntegrityViolationException.class);
        } finally {
            cleanup(curriculumId, instructorId);
        }
    }

    /** 핸들러: DataIntegrityViolationException → 409 + 안정적인 코드. */
    @Test
    void handler_maps_data_integrity_violation_to_409() {
        ResponseEntity<ErrorResponse> response = new CurriculumExceptionHandler()
                .handleConflict(new DataIntegrityViolationException("uq_section_order"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().code()).isEqualTo("CURRICULUM_STRUCTURE_CONFLICT");
    }

    // ---- 헬퍼 (각 커밋은 자기 트랜잭션) ----

    private void commitSection(UUID curriculumId, int order) {
        Section s = new Section();
        s.setCurriculumId(curriculumId);
        s.setTitle("order=" + order);
        s.setOrderIndex(order);
        sectionRepository.save(s);
    }

    private UUID seedInstructor() {
        AppUser u = new AppUser();
        u.setEmail("conflict-" + UUID.randomUUID() + "@liveclass.test");
        u.setPasswordHash("{noop}x");
        u.setDisplayName("강사");
        u.setRole(Role.INSTRUCTOR);
        u.setStatus(AccountStatus.ACTIVE);
        return appUserRepository.save(u).getId();
    }

    private UUID seedCurriculum(UUID instructorId) {
        Curriculum c = new Curriculum();
        c.setInstructorId(instructorId);
        c.setTitle("충돌 테스트");
        c.setLifecycleStatus(CurriculumLifecycleStatus.DRAFT);
        c.setEnrollmentType(EnrollmentType.IMMEDIATE);
        c.setStructureVersion(0);
        c.setSectionCount(0);
        c.setLessonCount(0);
        c.setPublishedLessonCount(0);
        return curriculumRepository.save(c).getId();
    }

    private void cleanup(UUID curriculumId, UUID instructorId) {
        sectionRepository.deleteAll(sectionRepository.findByCurriculumIdOrderByOrderIndexAsc(curriculumId));
        curriculumRepository.deleteById(curriculumId);
        appUserRepository.deleteById(instructorId);
    }
}
