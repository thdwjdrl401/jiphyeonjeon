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

        @Schema(description = "강사가 선택한 영역만 렌더한 PNG. data URI. 1920x1080 논리 프레임과 같은 축척이다.",
                example = "data:image/png;base64,iVBORw0KGgo...")
        @NotBlank
        @Pattern(regexp = "data:image/(png|jpeg);base64,[A-Za-z0-9+/=]+", message = "PNG 또는 JPEG data URI여야 합니다.")
        String image,

        @Schema(description = "강사가 선택한 요소 id. 해석에 성공하면 이것들이 교체 대상이 된다.")
        @Size(max = 500)
        List<String> elementIds) {

    public AnnotationInterpretRequest {
        elementIds = elementIds == null ? List.of() : List.copyOf(elementIds);
    }
}
