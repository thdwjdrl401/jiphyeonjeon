package com.liveclass.live.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.util.List;

/**
 * 판서 해석 요청(CONTRACT §3-6e).
 *
 * <p>이미지와 <b>강사가 선택한 요소 id</b>를 함께 보낸다. 이미지는 읽기용이고, id는 "무엇을 지울
 * 것인가"의 범위다 — 모델에게 대상을 맞히게 하지 않는다.
 */
@Schema(description = "판서 해석 요청. 응답에는 좌표가 없다(ADR-0054).")
public record AnnotationInterpretRequest(

        @Schema(description = "해석 방식.", allowableValues = {"diagram", "math"})
        @NotBlank
        @Pattern(regexp = "diagram|math")
        String mode,

        /*
         * <b>상한을 여기서 건다.</b> 없으면 큰 본문이 그대로 통과해 힙에 올라간다 — Spring은 JSON
         * 본문 크기를 기본으로 제한하지 않고, 상류(GMS) 호출 직전에야 크기를 보면 이미 늦다.
         *
         * base64는 원본의 약 4/3이므로 6MB면 원본 4.5MB쯤이다. 선택 영역 하나를 PNG로 담으면
         * 이보다 훨씬 작다(실측: 판서 15개 1528x721이 12KB).
         */
        @Schema(description = "강사가 선택한 영역만 렌더한 PNG. data URI. 선택 내용만 담기며 프레임 전체가 아니다.",
                example = "data:image/png;base64,iVBORw0KGgo...")
        @NotBlank
        @Size(max = 6_000_000, message = "판서 이미지가 너무 큽니다.")
        @Pattern(regexp = "data:image/(png|jpeg);base64,[A-Za-z0-9+/=]+", message = "PNG 또는 JPEG data URI여야 합니다.")
        String image,

        @Schema(description = "강사가 선택한 요소 id. 해석에 성공하면 이것들이 교체 대상이 된다.")
        @Size(max = 500)
        List<String> elementIds) {

    public AnnotationInterpretRequest {
        elementIds = elementIds == null ? List.of() : List.copyOf(elementIds);
    }
}
