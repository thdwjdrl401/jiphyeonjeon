package com.liveclass.curriculum;

import com.liveclass.auth.domain.AccountStatus;
import com.liveclass.auth.domain.AppUser;
import com.liveclass.auth.domain.Role;
import com.liveclass.auth.repository.AppUserRepository;
import com.liveclass.curriculum.domain.Curriculum;
import com.liveclass.curriculum.domain.Section;
import com.liveclass.curriculum.service.InstructorCurriculumService;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * curriculum.section_count는 DB 트리거가 소유한다(DDL: '섹션 수(트리거 유지...)').
 * 앱이 같은 컬럼을 또 쓰면 이중 반영으로 삭제 시 음수가 된다.
 *
 * 이 테스트는 연산 사이에 영속성 컨텍스트를 비워(clear) 매 요청이 새 컨텍스트인 운영 환경을
 * 재현하고, DB에 실제로 쓰인 값을 네이티브로 읽어 검증한다 — 그렇게 하지 않으면 1차 캐시의
 * in-memory 값이 트리거 결과를 가려 버그를 놓친다(실제로 놓쳤던 회귀).
 */
@SpringBootTest
@Transactional
class SectionCounterTest {

    @Autowired
    private InstructorCurriculumService service;

    @Autowired
    private AppUserRepository appUserRepository;

    @Autowired
    private EntityManager em;

    @Test
    void section_count_is_trigger_owned_and_never_double_counted() {
        UUID instructor = seedInstructor();

        Curriculum curriculum = service.create(instructor, "카운터 검증", null, null, null);
        UUID id = curriculum.getId();
        assertThat(dbSectionCount(id)).isEqualTo(0);

        Section first = service.createSection(instructor, id, "섹션1", null);
        assertThat(dbSectionCount(id)).isEqualTo(1);

        service.createSection(instructor, id, "섹션2", null);
        assertThat(dbSectionCount(id)).isEqualTo(2);

        service.deleteSection(instructor, first.getId());
        // 트리거만 −1 → 1. 앱이 이중 감소하면 0 이하로 떨어진다.
        assertThat(dbSectionCount(id)).isEqualTo(1);
    }

    /** flush로 트리거를 발화시키고 clear로 캐시를 비운 뒤 DB 컬럼을 직접 읽는다. */
    private int dbSectionCount(UUID curriculumId) {
        em.flush();
        em.clear();
        Number count = (Number) em.createNativeQuery(
                        "SELECT section_count FROM core.curriculum WHERE id = :id")
                .setParameter("id", curriculumId)
                .getSingleResult();
        return count.intValue();
    }

    private UUID seedInstructor() {
        AppUser user = new AppUser();
        user.setEmail("counter-" + UUID.randomUUID() + "@liveclass.test");
        user.setPasswordHash("{noop}x");
        user.setDisplayName("강사");
        user.setRole(Role.INSTRUCTOR);
        user.setStatus(AccountStatus.ACTIVE);
        return appUserRepository.saveAndFlush(user).getId();
    }
}
