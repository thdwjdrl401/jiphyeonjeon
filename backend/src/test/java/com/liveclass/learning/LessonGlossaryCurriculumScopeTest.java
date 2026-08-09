package com.liveclass.learning;

import com.liveclass.learning.api.LessonLearningAccess;
import com.liveclass.learning.repository.LessonGlossaryOverrideRepository;
import com.liveclass.learning.service.LessonGlossaryService;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.jpa.repository.Query;

import java.lang.reflect.Method;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 용어집은 <b>커리큘럼에 붙인 자료</b>의 용어까지 모아야 한다.
 *
 * <p>커리큘럼 자료는 {@code lesson_id IS NULL}로 표현되므로(ADR-0045) 강의로만 걸러서는 절대 잡히지
 * 않는다. 운영에서 용어를 12개 뽑아 저장해 두고도 화면에는 하나도 뜨지 않았고, 원인이 이 조건이었다.
 *
 * <p>ai 스키마는 남의 것이라 테스트에서 채우지 않는 것이 이 저장소의 규칙이다
 * ({@code LessonGlossaryContractTest}). 그래서 <b>범위를 넘기는 배선</b>과 <b>쿼리의 조건</b>을 각각
 * 고정한다 — 이 사고는 그 둘 중 하나만 어긋나도 재발한다.
 */
class LessonGlossaryCurriculumScopeTest {

    @Test
    void the_glossary_asks_for_the_curriculum_scope_not_just_the_lesson() {
        UUID userId = UUID.randomUUID();
        UUID lessonId = UUID.randomUUID();
        UUID curriculumId = UUID.randomUUID();

        LessonGlossaryOverrideRepository repository = mock(LessonGlossaryOverrideRepository.class);
        LessonLearningAccess access = mock(LessonLearningAccess.class);
        LessonGlossaryService service = new LessonGlossaryService(
                repository, access, mock(ApplicationEventPublisher.class));

        when(repository.sourceTableExists()).thenReturn(true);
        when(access.curriculumIdOf(lessonId)).thenReturn(curriculumId);
        when(repository.findSourceTerms(curriculumId, lessonId)).thenReturn(List.of(
                sourceTerm("교착 상태", "두 트랜잭션이 서로의 잠금을 기다리는 상태")));
        when(repository.findByLessonId(lessonId)).thenReturn(List.of());

        List<LessonGlossaryService.GlossaryTerm> glossary = service.glossary(userId, lessonId);

        // 강의만 넘기던 예전 배선이면 커리큘럼 자료의 용어를 영영 못 본다.
        verify(access).curriculumIdOf(lessonId);
        verify(repository).findSourceTerms(curriculumId, lessonId);
        assertThat(glossary).extracting(LessonGlossaryService.GlossaryTerm::term)
                .containsExactly("교착 상태");
    }

    /**
     * 배선이 맞아도 조건이 강의로만 걸리면 그대로 못 본다. ai 스키마를 채우지 않고 이 조건을 지키는
     * 방법은 쿼리 자체를 읽는 것뿐이다.
     */
    @Test
    void the_source_query_includes_curriculum_scoped_materials() throws Exception {
        Method method = LessonGlossaryOverrideRepository.class
                .getMethod("findSourceTerms", UUID.class, UUID.class);
        String sql = method.getAnnotation(Query.class).value().replaceAll("\\s+", " ");

        assertThat(sql).contains("mv.curriculum_id = :curriculumId");
        // lesson_id IS NULL 이 곧 "커리큘럼에 붙인 자료"다(ADR-0045).
        assertThat(sql).contains("(mv.lesson_id IS NULL OR mv.lesson_id = :lessonId)");
        // 옛 버전의 용어가 섞이지 않게 하는 조건은 그대로 남아 있어야 한다.
        assertThat(sql).contains("mv.activated_at IS NOT NULL");
        assertThat(sql).contains("mv.retired_at IS NULL");
    }

    private LessonGlossaryOverrideRepository.SourceTerm sourceTerm(String term, String definition) {
        return new LessonGlossaryOverrideRepository.SourceTerm() {
            @Override
            public String getTerm() {
                return term;
            }

            @Override
            public String getDefinition() {
                return definition;
            }
        };
    }
}
