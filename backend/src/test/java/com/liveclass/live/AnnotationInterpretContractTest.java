package com.liveclass.live;

import com.liveclass.live.api.AnnotationVisionModel;
import com.liveclass.live.service.AnnotationInterpretException;
import com.liveclass.live.service.AnnotationInterpretService;
import com.liveclass.live.service.AnnotationInterpretation;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 판서 해석 계약(ADR-0054, CONTRACT §3-6e).
 *
 * <p>여기서 고정하는 것은 하나다 — <b>모델에게 좌표를 묻지 않고, 모델이 좌표를 줘도 쓰지 않는다.</b>
 * 실측에서 모델이 낸 도형 좌표는 최대 96px(그림 크기의 2~13%) 틀렸다. 같은 좌표를 클라이언트는
 * 획의 점에서 오차 없이 갖고 있으므로, 물어볼 이유가 없고 받아들일 이유는 더 없다.
 *
 * <p>나머지는 그 원칙에서 따라오는 것들이다 — 무엇을 지울지는 <b>강사의 선택</b>에서 나오고,
 * 읽지 못한 것은 지어내지 않는다.
 */
class AnnotationInterpretContractTest {

    /** 모델 자리에 끼우는 스텁. 무엇을 물었는지도 함께 기록한다. */
    private static final class StubModel implements AnnotationVisionModel {
        private final String answer;
        private final List<String> prompts = new ArrayList<>();
        private final List<String> schemas = new ArrayList<>();
        private final List<String> toolNames = new ArrayList<>();

        private StubModel(String answer) {
            this.answer = answer;
        }

        @Override
        public String callTool(String prompt, String imageDataUri, String toolName, String toolParameters) {
            prompts.add(prompt);
            toolNames.add(toolName);
            schemas.add(toolParameters);
            return answer;
        }
    }

    private static final String IMAGE = "data:image/png;base64,iVBORw0KGgo=";

    private static AnnotationInterpretation interpret(String mode, StubModel model, List<String> selected) {
        return new AnnotationInterpretService(model).interpret(mode, IMAGE, selected);
    }

    /**
     * mermaid 정의에는 좌표가 없다. 그래서 모델이 배치를 추정할 자리가 <b>원천적으로</b> 없고,
     * 실제 배치는 클라이언트가 dagre로 계산한다.
     */
    @Test
    void 다이어그램은_mermaid_정의로_돌려준다() {
        StubModel model = new StubModel("""
                {"definition":"flowchart LR\\n  A[요청] --> B[인증]","confidence":0.9,"unreadable":false}""");

        AnnotationInterpretation result = interpret("diagram", model, List.of("e1", "e2"));

        assertThat(result.kind()).isEqualTo("mermaid");
        assertThat(result.body()).contains("flowchart LR").contains("A[요청] --> B[인증]");
        assertThat(result.unreadable()).isFalse();
    }

    @Test
    void 수식은_LaTeX로_돌려준다() {
        StubModel model = new StubModel("""
                {"latex":"y = ax^2 + bx + c","confidence":0.95,"unreadable":false}""");

        AnnotationInterpretation result = interpret("math", model, List.of("e1"));

        assertThat(result.kind()).isEqualTo("latex");
        assertThat(result.body()).isEqualTo("y = ax^2 + bx + c");
    }

    /**
     * 모델에게 좌표를 <b>물어보지도 않는다</b>. 스키마에 좌표 필드가 생기는 순간 모델이 채우기
     * 시작하고, 그 값은 실측에서 최대 96px 틀렸다.
     */
    @Test
    void 모델에게_좌표를_묻지_않는다() {
        StubModel model = new StubModel("""
                {"definition":"flowchart LR\\n  A[a] --> B[b]","confidence":1,"unreadable":false}""");

        interpret("diagram", model, List.of("e1"));

        assertThat(model.schemas.getFirst())
                .doesNotContain("\"x\"").doesNotContain("\"y\"")
                .doesNotContain("width").doesNotContain("height");
        // 프롬프트에서도 명시적으로 금지한다.
        assertThat(model.prompts.getFirst()).contains("좌표");
    }

    /** 모델이 좌표를 얹어 보내도 결과에 실리지 않는다 — 우리 계약에 그런 자리가 없다. */
    @Test
    void 모델이_좌표를_보내도_쓰지_않는다() {
        StubModel model = new StubModel("""
                {"definition":"flowchart LR\\n  A[a] --> B[b]","x":420,"y":110,"width":980,
                 "confidence":0.9,"unreadable":false}""");

        AnnotationInterpretation result = interpret("diagram", model, List.of("e1"));

        assertThat(result.body()).doesNotContain("420").doesNotContain("980");
    }

    /**
     * 지울 대상은 <b>강사가 선택한 것</b>이다. 모델에게 맞히게 하면 엉뚱한 요소를 지울 수 있고,
     * 그 사고는 되돌릴 수 없다.
     */
    @Test
    void 지울_대상은_강사의_선택에서만_나온다() {
        StubModel model = new StubModel("""
                {"definition":"flowchart LR\\n  A[a] --> B[b]","replace":["남의요소","또다른것"],
                 "confidence":0.9,"unreadable":false}""");

        AnnotationInterpretation result = interpret("diagram", model, List.of("e1", "e2"));

        assertThat(result.replace()).containsExactly("e1", "e2");
    }

    @Test
    void 선택이_없으면_지울_것도_없다() {
        StubModel model = new StubModel("""
                {"latex":"x","confidence":0.9,"unreadable":false}""");

        assertThat(interpret("math", model, List.of()).replace()).isEmpty();
    }

    /** 읽지 못한 것은 지어내지 않는다. 강사에게 "못 읽었다"고 말하는 편이 낫다. */
    @Test
    void 읽지_못하면_본문을_비운다() {
        StubModel model = new StubModel("""
                {"latex":"","confidence":0.1,"unreadable":true}""");

        AnnotationInterpretation result = interpret("math", model, List.of("e1"));

        assertThat(result.unreadable()).isTrue();
        assertThat(result.body()).isEmpty();
    }

    /** `unreadable`을 세우지 않고 본문만 비워 오는 경우가 있다. 빈 것은 못 읽은 것이다. */
    @Test
    void 본문이_비면_읽지_못한_것으로_본다() {
        StubModel model = new StubModel("""
                {"definition":"   ","confidence":0.9,"unreadable":false}""");

        assertThat(interpret("diagram", model, List.of("e1")).unreadable()).isTrue();
    }

    /** 모델이 툴 대신 산문으로 답하는 경우다. 파싱할 것이 없으므로 못 읽은 것으로 본다. */
    @Test
    void 툴을_부르지_않으면_읽지_못한_것으로_본다() {
        assertThat(interpret("diagram", new StubModel(null), List.of("e1")).unreadable()).isTrue();
    }

    /**
     * `confidence`는 참고값이다. 자동 적용의 근거로 쓰지 않기로 했지만(실측에서 틀린 라벨에 1.0이
     * 붙었다) 강사에게 보여 주므로 범위는 지켜야 한다.
     */
    @Test
    void confidence는_0과_1_사이로_고정한다() {
        StubModel high = new StubModel("""
                {"latex":"x","confidence":7.5,"unreadable":false}""");
        StubModel low = new StubModel("""
                {"latex":"x","confidence":-3,"unreadable":false}""");

        assertThat(interpret("math", high, List.of()).confidence()).isEqualTo(1.0);
        assertThat(interpret("math", low, List.of()).confidence()).isZero();
    }

    @Test
    void 알_수_없는_모드는_거부한다() {
        assertThatThrownBy(() -> interpret("draw-me-a-cat", new StubModel("{}"), List.of()))
                .isInstanceOf(AnnotationInterpretException.class);
    }

    /** 모드에 따라 다른 함수를 지목한다 — 스키마가 섞이면 결과 종류를 신뢰할 수 없다. */
    @Test
    void 모드마다_다른_툴을_지목한다() {
        StubModel diagram = new StubModel("""
                {"definition":"flowchart LR\\n A[a] --> B[b]","confidence":1,"unreadable":false}""");
        StubModel math = new StubModel("""
                {"latex":"x","confidence":1,"unreadable":false}""");

        interpret("diagram", diagram, List.of());
        interpret("math", math, List.of());

        assertThat(diagram.toolNames).containsExactly("to_mermaid");
        assertThat(math.toolNames).containsExactly("recognize_math");
    }
}
