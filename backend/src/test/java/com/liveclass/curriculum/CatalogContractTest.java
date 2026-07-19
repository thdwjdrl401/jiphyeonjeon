package com.liveclass.curriculum;

import com.liveclass.auth.domain.AccountStatus;
import com.liveclass.auth.domain.AppUser;
import com.liveclass.auth.domain.InstructorProfile;
import com.liveclass.auth.domain.Role;
import com.liveclass.auth.repository.AppUserRepository;
import com.liveclass.auth.repository.InstructorProfileRepository;
import com.liveclass.curriculum.domain.Curriculum;
import com.liveclass.curriculum.domain.CurriculumLifecycleStatus;
import com.liveclass.curriculum.domain.EnrollmentType;
import com.liveclass.curriculum.repository.CurriculumRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 공개 카탈로그 계약 검증 (CATALOG-01, CURRICULUM-DETAIL-01).
 * 발행 흐름이 아직 없어 리포지토리로 직접 PUBLISHED/DRAFT 상태를 세팅해 데이터를 만든다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class CatalogContractTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private CurriculumRepository curriculumRepository;

    @Autowired
    private AppUserRepository appUserRepository;

    @Autowired
    private InstructorProfileRepository instructorProfileRepository;

    // ---- 목록 ----

    @Test
    void public_list_is_accessible_without_auth_and_returns_page_envelope() throws Exception {
        UUID instructor = seedInstructor("이강사", "실시간을 가르칩니다", List.of("Spring", "WebRTC"));
        seedCurriculum(instructor, "실시간 Spring 입문", CurriculumLifecycleStatus.PUBLISHED);

        mockMvc.perform(get("/api/curriculums"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isArray())
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.hasNext").exists())
                .andExpect(jsonPath("$.items[0].curriculumId").exists())
                .andExpect(jsonPath("$.items[0].instructor.displayName").value("이강사"))
                .andExpect(jsonPath("$.items[0].instructor.expertise[0]").value("Spring"));
    }

    @Test
    void list_excludes_draft_curriculums() throws Exception {
        UUID instructor = seedInstructor("강사", null, List.of());
        seedCurriculum(instructor, "공개된 것", CurriculumLifecycleStatus.PUBLISHED);
        seedCurriculum(instructor, "숨겨진 초안", CurriculumLifecycleStatus.DRAFT);

        mockMvc.perform(get("/api/curriculums").param("q", "숨겨진"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0));

        mockMvc.perform(get("/api/curriculums").param("q", "공개된"))
                .andExpect(jsonPath("$.totalElements").value(1));
    }

    @Test
    void list_search_matches_title_case_insensitively() throws Exception {
        UUID instructor = seedInstructor("강사", null, List.of());
        seedCurriculum(instructor, "Spring Boot 심화", CurriculumLifecycleStatus.PUBLISHED);

        mockMvc.perform(get("/api/curriculums").param("q", "spring"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1));
    }

    @Test
    void list_rejects_unknown_sort_with_400() throws Exception {
        mockMvc.perform(get("/api/curriculums").param("sort", "NONSENSE"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
    }

    @Test
    void list_size_is_capped_by_server() throws Exception {
        mockMvc.perform(get("/api/curriculums").param("size", "9999"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.size").value(100));
    }

    // ---- 상세 ----

    @Test
    void detail_returns_basic_info_and_instructor_without_auth() throws Exception {
        UUID instructor = seedInstructor("이강사", "소개", List.of("Spring"));
        Curriculum curriculum = seedCurriculum(instructor, "상세 대상", CurriculumLifecycleStatus.PUBLISHED);

        mockMvc.perform(get("/api/curriculums/" + curriculum.getId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.curriculumId").value(curriculum.getId().toString()))
                .andExpect(jsonPath("$.title").value("상세 대상"))
                .andExpect(jsonPath("$.instructor.displayName").value("이강사"))
                .andExpect(jsonPath("$.outline").isArray());
    }

    @Test
    void detail_of_draft_returns_404() throws Exception {
        UUID instructor = seedInstructor("강사", null, List.of());
        Curriculum draft = seedCurriculum(instructor, "초안", CurriculumLifecycleStatus.DRAFT);

        mockMvc.perform(get("/api/curriculums/" + draft.getId()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("CURRICULUM_NOT_FOUND"));
    }

    @Test
    void detail_of_unknown_id_returns_404() throws Exception {
        mockMvc.perform(get("/api/curriculums/" + UUID.randomUUID()))
                .andExpect(status().isNotFound());
    }

    // ---- 시드 헬퍼 (발행 흐름 부재로 리포지토리 직접 세팅) ----

    private UUID seedInstructor(String displayName, String bio, List<String> expertise) {
        AppUser user = new AppUser();
        user.setEmail("inst-" + UUID.randomUUID() + "@liveclass.test");
        user.setPasswordHash("{noop}x");
        user.setDisplayName(displayName);
        user.setRole(Role.INSTRUCTOR);
        user.setStatus(AccountStatus.ACTIVE);
        AppUser saved = appUserRepository.saveAndFlush(user);

        InstructorProfile profile = new InstructorProfile();
        profile.setUserId(saved.getId());
        profile.setBio(bio);
        profile.setExpertise(expertise);
        instructorProfileRepository.saveAndFlush(profile);
        return saved.getId();
    }

    private Curriculum seedCurriculum(UUID instructorId, String title, CurriculumLifecycleStatus status) {
        Curriculum c = new Curriculum();
        c.setInstructorId(instructorId);
        c.setTitle(title);
        c.setLifecycleStatus(status);
        c.setEnrollmentType(EnrollmentType.IMMEDIATE);
        c.setStructureVersion(0);
        c.setSectionCount(0);
        c.setLessonCount(0);
        c.setPublishedLessonCount(0);
        return curriculumRepository.saveAndFlush(c);
    }
}
