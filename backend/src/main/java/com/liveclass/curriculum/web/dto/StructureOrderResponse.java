package com.liveclass.curriculum.web.dto;

import com.liveclass.curriculum.service.StructureOrder;
import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;

/**
 * 구조 순서 저장 결과. order는 저장된 order_index 그대로이며 0-based다 —
 * 기존 API(SectionResponse.orderIndex·LessonView.order·OutlineLesson.order)와 같은 규약을 쓴다.
 */
@Schema(description = "저장된 구조 순서. order는 0-based(기존 조회 API와 동일 규약).")
public record StructureOrderResponse(

        @Schema(description = "저장 후 structureVersion(요청 baseVersion + 1)", example = "8")
        int structureVersion,

        List<SectionOrderView> sections
) {

    @Schema(description = "섹션과 그 안의 레슨 순서")
    public record SectionOrderView(String sectionId, int order, List<LessonOrderView> lessons) {
    }

    @Schema(description = "레슨 순서")
    public record LessonOrderView(String lessonId, int order) {
    }

    public static StructureOrderResponse from(StructureOrder order) {
        return new StructureOrderResponse(
                order.structureVersion(),
                order.sections().stream()
                        .map(section -> new SectionOrderView(
                                section.sectionId().toString(),
                                section.order(),
                                section.lessons().stream()
                                        .map(lesson -> new LessonOrderView(
                                                lesson.lessonId().toString(), lesson.order()))
                                        .toList()))
                        .toList());
    }
}
