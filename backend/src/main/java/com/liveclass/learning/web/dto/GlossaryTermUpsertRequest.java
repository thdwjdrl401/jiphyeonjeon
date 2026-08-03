package com.liveclass.learning.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 강사의 용어 수정·추가. 같은 용어를 다시 쓰면 덮어쓴다. */
@Schema(description = "용어 수정·추가")
public record GlossaryTermUpsertRequest(

        @Schema(description = "용어 이름. ai 원본에 있으면 그 정의를 덮고, 없으면 새 용어가 된다.")
        @NotBlank @Size(max = 200)
        String term,

        @Schema(description = "정의")
        @NotBlank @Size(max = 2000)
        String definition) {
}
