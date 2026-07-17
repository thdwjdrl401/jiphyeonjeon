package com.liveclass.common.web;

import com.fasterxml.jackson.annotation.JsonInclude;
import io.swagger.v3.oas.annotations.media.Schema;
import org.slf4j.MDC;

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

        @Schema(description = "로그 추적용 상관관계 ID(요청 traceId와 동일 — 로그 검색 키)", example = "a1b2c3d4e5f6...")
        String correlationId
) {

    @Schema(description = "필드 단위 검증 오류")
    public record FieldErrorItem(String field, String code) {
    }

    public static ErrorResponse of(String code, String message) {
        return new ErrorResponse(code, message, null, currentCorrelationId());
    }

    public static ErrorResponse of(String code, String message, List<FieldErrorItem> fieldErrors) {
        return new ErrorResponse(code, message, fieldErrors, currentCorrelationId());
    }

    /**
     * 응답의 correlationId를 요청 traceId로 채운다 — 사용자가 들고 온 이 값으로 로그를 검색할 수 있게.
     * traceId는 Micrometer Tracing이 요청마다 MDC에 넣는다. 트레이스 컨텍스트가 없으면(배치·부팅 등)
     * UUID로 폴백한다. FE 계약(client.ts)의 필드명 correlationId는 유지한다.
     */
    private static String currentCorrelationId() {
        String traceId = MDC.get("traceId");
        return traceId != null ? traceId : UUID.randomUUID().toString();
    }
}
