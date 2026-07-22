package com.liveclass.curriculum.web.dto;

import com.liveclass.common.web.ErrorResponse;
import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 409 STRUCTURE_VERSION_CONFLICT 전용 오류 본문.
 *
 * <p>공용 {@link ErrorResponse} 봉투에는 도메인 데이터를 실을 자리가 없다(code·message·fieldErrors·
 * correlationId). 커리큘럼 하나의 사정 때문에 공용 봉투에 필드를 늘리는 대신, 봉투를 그대로 복사하고
 * {@code structureVersion} 한 칸만 더한 <b>상위집합</b> 본문을 이 케이스에만 쓴다. FE는 평소처럼
 * {@code code}로 분기하고, 재조회 없이 {@code structureVersion}에서 최신 버전을 바로 읽을 수 있다.
 * (message에도 같은 값을 넣어 두어 로그만 봐도 확인된다.)
 */
@Schema(description = "구조 버전 충돌 응답. 공용 오류 봉투 + 최신 structureVersion.")
public record StructureConflictResponse(

        String code,
        String message,

        @Schema(description = "서버의 현재 structureVersion. 이 값으로 다시 조회해 사용자 변경을 재적용한다.", example = "9")
        int structureVersion,

        String correlationId
) {

    public static StructureConflictResponse of(String code, String message, int structureVersion) {
        ErrorResponse envelope = ErrorResponse.of(code, message);
        return new StructureConflictResponse(
                envelope.code(), envelope.message(), structureVersion, envelope.correlationId());
    }
}
