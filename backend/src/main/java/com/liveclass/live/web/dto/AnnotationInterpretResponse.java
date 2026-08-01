package com.liveclass.live.web.dto;

import com.liveclass.live.service.AnnotationInterpretation;
import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;

/**
 * 판서 해석 결과(CONTRACT §3-6e).
 *
 * <p><b>좌표 필드가 없다.</b> 모델에게 위치를 묻지 않기 때문이다 — 실측에서 최대 96px 틀렸고, 같은
 * 좌표를 클라이언트는 획의 점에서 오차 없이 갖고 있다.
 */
@Schema(description = "판서 해석 결과. 좌표를 담지 않는다 — 배치는 클라이언트가 계산한다.")
public record AnnotationInterpretResponse(

        @Schema(description = "결과 종류.", allowableValues = {"mermaid", "math"})
        String kind,

        @Schema(description = "판서에 그대로 넣을 것. 다이어그램은 mermaid 정의, 수식은 유니코드 문자열이다 "
                + "— Excalidraw에 수식 렌더러가 없어 LaTeX를 넣으면 글자 그대로 보인다. unreadable이면 빈 문자열.")
        String body,

        @Schema(description = "수식일 때의 LaTeX 원문. 지금은 넣지 않고 다시보기 앵커·그래프·RAG에 쓰려고 남긴다.")
        String source,

        @Schema(description = "지울 요소 id. 요청의 elementIds 부분집합이다.")
        List<String> replace,

        @Schema(description = "모델이 스스로 매긴 값. 자동 적용의 근거로 쓰지 않는다 — "
                + "실측에서 틀린 라벨에 1.0이 붙었다. 강사에게 보여 주는 참고값이다.")
        double confidence,

        @Schema(description = "읽지 못했다. true면 body를 쓰지 않는다.")
        boolean unreadable) {

    public static AnnotationInterpretResponse from(AnnotationInterpretation result) {
        return new AnnotationInterpretResponse(
                result.kind(), result.body(), result.source(), result.replace(), result.confidence(), result.unreadable());
    }
}
