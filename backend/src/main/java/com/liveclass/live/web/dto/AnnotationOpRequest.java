package com.liveclass.live.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;

import java.time.OffsetDateTime;

/**
 * 강사가 적재를 요청하는 판서 op 하나(CONTRACT §3-6b).
 *
 * <p>라이브 전달은 LiveKit 데이터 채널이 이미 했고, 이건 <b>기록용</b>이다. 그래서 응답을 기다려
 * 화면을 갱신하지 않는다 — 저장이 느리거나 실패해도 판서는 이미 수강생에게 가 있다.
 */
@Schema(description = "판서 op 적재 요청. 라이브 전달과 별개인 기록 경로다.")
public record AnnotationOpRequest(

        @Schema(description = "세션 안에서 단조 증가하는 op 번호. 재전송은 같은 번호로 오며 중복 적재되지 않는다.",
                example = "42")
        @PositiveOrZero
        long revision,

        @Schema(description = "op 종류.", allowableValues = {"snapshot", "upsert", "delete", "clear"})
        @NotBlank
        @Pattern(regexp = "snapshot|upsert|delete|clear")
        String opType,

        @Schema(description = "op 본문(JSON 문자열). Excalidraw 요소를 그대로 담는다. 서버는 해석하지 않는다.")
        @NotBlank
        String payload,

        @Schema(description = "강사 브라우저가 op를 만든 시각. 세션 상대 ms(앵커) 계산의 입력이다.")
        @NotNull
        OffsetDateTime occurredAt) {
}
