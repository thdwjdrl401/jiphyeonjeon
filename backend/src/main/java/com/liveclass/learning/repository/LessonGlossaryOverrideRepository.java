package com.liveclass.learning.repository;

import com.liveclass.learning.domain.LessonGlossaryOverride;
import com.liveclass.learning.domain.LessonGlossaryOverrideId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface LessonGlossaryOverrideRepository
        extends JpaRepository<LessonGlossaryOverride, LessonGlossaryOverrideId> {

    List<LessonGlossaryOverride> findByLessonId(UUID lessonId);

    /**
     * AI가 뽑은 원본 용어(MR !228, ai-worker 소유). <b>읽기만 한다</b> — 남의 스키마다(CONTRACT §4).
     *
     * <p>활성 버전만 본다. 자료를 다시 올리면 옛 버전이 retire되는데, 그 용어까지 섞이면 지운 자료의
     * 용어가 자막에 계속 링크로 걸린다.
     */
    @Query(value = """
            SELECT kt.term AS term, kt.definition AS definition
            FROM ai.material_key_term kt
            JOIN ai.material_version mv ON mv.id = kt.material_version_id
            WHERE mv.lesson_id = :lessonId
              AND mv.activated_at IS NOT NULL
              AND mv.retired_at IS NULL
            ORDER BY kt.term
            """, nativeQuery = true)
    List<SourceTerm> findSourceTerms(@Param("lessonId") UUID lessonId);

    /**
     * ai 원본 표가 있는가. <b>먼저 물어봐야 한다.</b>
     *
     * <p>{@code ai} 스키마는 ai-worker의 마이그레이션이 만든다 — 로컬·테스트처럼 AI 스택 없이 도는
     * 환경에는 없다. 없는 표를 조회하면 예외가 나고, 그러면 <b>트랜잭션이 롤백 전용으로 표시돼</b>
     * 예외를 잡아도 커밋에서 다시 터진다(강사 수정본까지 못 읽게 된다). 카탈로그 조회는 표가 없어도
     * 실패하지 않으므로 이걸로 먼저 가른다.
     */
    @Query(value = "SELECT to_regclass('ai.material_key_term') IS NOT NULL", nativeQuery = true)
    boolean sourceTableExists();

    /** ai 쪽 원본 한 줄. */
    interface SourceTerm {
        String getTerm();

        String getDefinition();
    }
}
