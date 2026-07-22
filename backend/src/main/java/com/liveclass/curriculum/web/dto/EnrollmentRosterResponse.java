package com.liveclass.curriculum.web.dto;

import com.liveclass.curriculum.service.EnrollmentRoster;
import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;

/**
 * 강사용 수강생 로스터 응답(CURRICULUM_MANAGEMENT §8.1) — summary + 공통 페이지 봉투.
 * 페이지 필드는 {@link PageResponse}가 만든 값을 그대로 펼친다(다른 페이징 모양을 새로 만들지 않는다).
 */
@Schema(description = "수강생 로스터 응답")
public record EnrollmentRosterResponse(
        EnrollmentStatusSummary summary,
        List<EnrollmentRosterItem> items,
        int page,
        int size,
        long totalElements,
        int totalPages,
        boolean hasNext
) {
    public static EnrollmentRosterResponse from(EnrollmentRoster roster) {
        PageResponse<EnrollmentRosterItem> p = PageResponse.of(roster.page(), EnrollmentRosterItem::from);
        return new EnrollmentRosterResponse(
                EnrollmentStatusSummary.from(roster.summary()),
                p.items(), p.page(), p.size(), p.totalElements(), p.totalPages(), p.hasNext());
    }
}
