package com.liveclass.common.web;

import com.fasterxml.jackson.annotation.JsonInclude;
import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;
import java.util.UUID;

/**
 * 오류 응답 봉투 (CONTRACT §2, docs/frontend/api/API_MAP.md §2.3 참고).
 * 프론트는 자유 형식 {@code message}가 아니라 안정적인 {@code code}로 분기한다.
 */
@Schema(description = "오류 응답 봉투. 프론트는 message가 아니라 code로 분기한다.")
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ErrorResponse(

        @Schema(description = "안정적인 오류 코드", example = "AUTH_INVALID_CREDENTIALS")
        String code,

        @Schema(description = "사람이 읽을 설명(화면 문구의 유일한 근거로 쓰지 않음)")
        String message,

        @Schema(description = "입력 필드별 검증 오류(있을 때만)")
        List<FieldErrorItem> fieldErrors,

        @Schema(description = "로그 추적용 상관관계 ID")
        String correlationId
) {

    @Schema(description = "필드 단위 검증 오류")
    public record FieldErrorItem(String field, String code) {
    }

    public static ErrorResponse of(String code, String message) {
        return new ErrorResponse(code, message, null, newCorrelationId());
    }

    public static ErrorResponse of(String code, String message, List<FieldErrorItem> fieldErrors) {
        return new ErrorResponse(code, message, fieldErrors, newCorrelationId());
    }

    private static String newCorrelationId() {
        return UUID.randomUUID().toString();
    }
}
