package com.liveclass.curriculum.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.time.OffsetDateTime;

@Schema(description = "전체 진행 기간. 미정이면 null.")
public record CurriculumPeriod(

        OffsetDateTime startsAt,
        OffsetDateTime endsAt
) {

    /** 시작·종료가 둘 다 없으면 기간 자체를 null로 둔다. */
    public static CurriculumPeriod of(OffsetDateTime startsAt, OffsetDateTime endsAt) {
        if (startsAt == null && endsAt == null) {
            return null;
        }
        return new CurriculumPeriod(startsAt, endsAt);
    }
}
