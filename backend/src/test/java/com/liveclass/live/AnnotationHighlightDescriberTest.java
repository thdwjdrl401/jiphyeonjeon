package com.liveclass.live;

import com.liveclass.live.api.AnnotationVisionModel;
import com.liveclass.live.service.AnnotationHighlightDescriber;
import com.liveclass.live.service.AnnotationInterpretException;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 강조 영역 설명 계약(ADR-0074).
 *
 * <p>여기서 고정하는 것은 하나다 — <b>읽지 못한 것을 지어내지 않는다.</b> AI 파트가 이 텍스트를
 * 검증 없이 신뢰하기로 했으므로(MR !350), 흐릿한 화면에 대한 추측이 그대로 영실이의 근거가 되고
 * 수강생 답변에 인용된다. 빈 근거를 색인하는 것보다 아무것도 색인하지 않는 편이 낫다.
 *
 * <p>판서 해석(ADR-0054)과 목적이 정반대라는 것도 함께 못박는다. 그쪽은 강조 표시를 빼야 하고
 * (도형으로 오독된다) 여기는 반드시 넣어야 한다(어디를 볼지 알려 주는 신호다).
 */
class AnnotationHighlightDescriberTest {

    private static final class StubModel implements AnnotationVisionModel {
        private final String answer;
        private final List<String> prompts = new ArrayList<>();
        private final List<String> urls = new ArrayList<>();

        private StubModel(String answer) {
            this.answer = answer;
        }

        @Override
        public String callTool(String prompt, String imageDataUri, String toolName, String toolParameters) {
            throw new AssertionError("강조 설명은 데이터 URI 경로를 쓰지 않는다 — 저장된 에셋 URL을 쓴다");
        }

        @Override
        public String callToolWithImageUrl(String prompt, String imageUrl, String toolName, String toolParameters) {
            prompts.add(prompt);
            urls.add(imageUrl);
            return answer;
        }
    }

    private static final String IMAGE_URL = "https://example.test/assets/crop.webp?sig=x";

    @Test
    void 읽은_내용을_그대로_돌려준다() {
        StubModel model = new StubModel("""
                {"text":"이진 탐색의 시간복잡도는 O(log n)","readable":true}""");

        assertThat(new AnnotationHighlightDescriber(model).describe(IMAGE_URL))
                .isEqualTo("이진 탐색의 시간복잡도는 O(log n)");
        // 데이터 URI가 아니라 저장된 이미지 URL을 그대로 넘긴다 — 바이트 왕복이 없다.
        assertThat(model.urls).containsExactly(IMAGE_URL);
    }

    /**
     * 읽지 못했으면 <b>null</b>이다. 빈 문자열이 아니다 — "읽었는데 아무것도 없다"와 "읽지 못했다"는
     * 다르고, 후자를 색인하면 빈 근거가 검색에 걸린다.
     */
    @Test
    void 읽지_못했으면_아무것도_돌려주지_않는다() {
        StubModel model = new StubModel("""
                {"text":"","readable":false}""");

        assertThat(new AnnotationHighlightDescriber(model).describe(IMAGE_URL)).isNull();
    }

    /** 모델이 readable=false인데 내용을 지어낸 경우. 그 문장은 근거가 될 수 없다. */
    @Test
    void 읽지_못했다면서_내용을_주면_버린다() {
        StubModel model = new StubModel("""
                {"text":"아마도 정렬 알고리즘에 대한 설명","readable":false}""");

        assertThat(new AnnotationHighlightDescriber(model).describe(IMAGE_URL)).isNull();
    }

    @Test
    void 공백만_있으면_읽지_못한_것으로_다룬다() {
        StubModel model = new StubModel("""
                {"text":"   ","readable":true}""");

        assertThat(new AnnotationHighlightDescriber(model).describe(IMAGE_URL)).isNull();
    }

    @Test
    void 모델이_답하지_않으면_실패로_올린다() {
        assertThatThrownBy(() -> new AnnotationHighlightDescriber(new StubModel(null)).describe(IMAGE_URL))
                .isInstanceOf(AnnotationInterpretException.class);
        assertThatThrownBy(() -> new AnnotationHighlightDescriber(new StubModel("이건 JSON이 아니다")).describe(IMAGE_URL))
                .isInstanceOf(AnnotationInterpretException.class);
    }

    /**
     * 프롬프트가 판서 해석과 갈라져 있어야 한다. 도형 정리용 지시로는 슬라이드 본문이 나오지 않고,
     * 강조 표시를 빼라고 하면 어디를 봐야 하는지 알 수 없게 된다.
     */
    @Test
    void 프롬프트는_강조_대상을_원문_그대로_요구한다() {
        StubModel model = new StubModel("""
                {"text":"x","readable":true}""");
        new AnnotationHighlightDescriber(model).describe(IMAGE_URL);

        String prompt = model.prompts.get(0);
        assertThat(prompt).contains("가리키는");
        assertThat(prompt).contains("원문 그대로");
        assertThat(prompt).contains("지어내지 마세요");
        assertThat(prompt).doesNotContain("mermaid");
    }

    /**
     * <b>OCR 덤프를 막는다</b>(ADR-0079 보강).
     *
     * <p>"글자를 그대로 옮기라"고만 했더니 모델이 화면의 글자를 줄바꿈으로 나열했다(운영 실측 190자).
     * 읽는 쪽은 화면을 볼 수 없어 항목만 늘어놓은 텍스트로는 관계를 알 수 없고, 그런 문장은 근거로
     * 인용해도 뜻이 서지 않는다. 무엇에 관한 것인지와 구성 요소 사이의 관계를 문장으로 요구한다.
     */
    @Test
    void 프롬프트는_나열이_아니라_관계_있는_서술을_요구한다() {
        StubModel model = new StubModel("""
                {"text":"x","readable":true}""");
        new AnnotationHighlightDescriber(model).describe(IMAGE_URL);

        String prompt = model.prompts.get(0);
        assertThat(prompt).contains("화면을 보지 못한 사람");
        assertThat(prompt).contains("첫 문장에서 이 부분이 무엇에 관한 것인지 밝히세요");
        assertThat(prompt).contains("관계와 함께");
        assertThat(prompt).contains("글자를 나열하기만 하면 안 됩니다");
    }

    /**
     * 자르지 않으므로 <b>색이 유일한 신호</b>다(ADR-0079).
     *
     * <p>예전에는 크롭이 "여기를 보라"를 대신했다. 화면 전체를 보내는 지금 색을 말하지 않으면 모델은
     * 강조를 찾을 방법이 없어 화면 전체를 요약하고, 강사가 표시하지도 않은 내용이 근거로 색인된다.
     * 그 값은 FE의 {@code HIGHLIGHT_STROKE_COLOR}이고 둘은 함께 움직여야 한다.
     */
    @Test
    void 프롬프트는_강조_색을_알리고_화면_전체_요약을_막는다() {
        StubModel model = new StubModel("""
                {"text":"x","readable":true}""");
        new AnnotationHighlightDescriber(model).describe(IMAGE_URL);

        String prompt = model.prompts.get(0);
        assertThat(prompt).contains("#f59f00");
        assertThat(prompt).contains("화면 전체를 요약하지 마세요");
        // 일반 판서(빨강)를 강조로 오인하면 그리다 만 획이 근거가 된다.
        assertThat(prompt).contains("빨간색 획은");
    }
}
