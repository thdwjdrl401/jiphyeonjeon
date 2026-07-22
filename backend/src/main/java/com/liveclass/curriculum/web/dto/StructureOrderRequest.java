package com.liveclass.curriculum.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

import java.util.List;
import java.util.UUID;

/**
 * 구조 순서 저장 요청 (STRUCTURE-01). 배열 위치가 곧 순서다 — order 값을 따로 보내지 않는다.
 * sections는 그 커리큘럼의 현재 섹션 전부를, lessonIds의 합집합은 현재 레슨 전부를 정확히 담아야 한다.
 */
@Schema(description = "섹션·레슨 전체 순서 저장 요청. 배열 위치가 순서이며, 커리큘럼의 모든 섹션·레슨을 빠짐없이 한 번씩 담아야 한다.")
public record StructureOrderRequest(

        @Schema(description = "클라이언트가 마지막으로 본 structureVersion. 서버 값과 다르면 409로 거절한다.", example = "7")
        @NotNull @PositiveOrZero Integer baseVersion,

        @Schema(description = "섹션 순서(배열 위치 = 순서)")
        @NotNull List<@NotNull @Valid SectionOrderItem> sections
) {

    @Schema(description = "섹션 한 칸과 그 안의 레슨 순서")
    public record SectionOrderItem(

            @NotNull UUID sectionId,

            @Schema(description = "이 섹션에 담을 레슨 순서(배열 위치 = 순서). 다른 섹션의 레슨도 옮겨 담을 수 있다.")
            @NotNull List<@NotNull UUID> lessonIds
    ) {
    }
}
