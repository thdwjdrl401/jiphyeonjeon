package com.liveclass.learning.web.dto;

import com.liveclass.learning.service.LessonGlossaryService;
import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 용어집 한 줄. {@code termId}는 용어 이름 그대로다 — 자료를 다시 올려도 바뀌지 않아야 하고,
 * 화면이 자막에서 찾을 때 쓰는 문자열과 같아야 한다.
 */
@Schema(description = "강의 용어집 한 줄. AI가 자료에서 뽑은 것을 강사 수정본이 덮어쓴다.")
public record GlossaryTermResponse(

        @Schema(description = "용어 이름. 자막에서 이 문자열을 찾아 링크를 건다.", example = "SecurityContext")
        String termId,

        String term,

        String definition,

        @Schema(description = "MATERIAL(AI가 자료에서 뽑음)·INSTRUCTOR(강사가 고치거나 더함)",
                example = "MATERIAL")
        String source) {

    public static GlossaryTermResponse from(LessonGlossaryService.GlossaryTerm term) {
        return new GlossaryTermResponse(term.term(), term.term(), term.definition(), term.source());
    }
}
