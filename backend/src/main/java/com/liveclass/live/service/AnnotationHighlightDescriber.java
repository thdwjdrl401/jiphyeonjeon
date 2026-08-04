package com.liveclass.live.service;

import com.liveclass.live.api.AnnotationVisionModel;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * 강조 영역을 <b>글로 옮긴다</b>(ADR-0074).
 *
 * <p>{@link AnnotationInterpretService}와 목적이 정반대다. 그쪽은 손그림을 mermaid·수식으로 <b>바꿔
 * 판서에 넣는</b> 것이고, 여기는 그 순간 화면에 무엇이 있었는지를 <b>검색 가능한 문장</b>으로 남기는
 * 것이다. 그래서 프롬프트를 나눈다 — 도형 정리용 지시로는 슬라이드 본문이 나오지 않는다.
 *
 * <p><b>강조 표시가 이미지에 들어 있다.</b> 그것을 지우거나 무시하라고 하지 않는다. 어디를 봐야
 * 하는지 알려 주는 유일한 신호이기 때문이다(해석 경로는 반대로 빼야 한다 — 도형으로 오독된다).
 *
 * <p><b>AI가 이 텍스트를 검증 없이 신뢰한다.</b> 그래서 지어내지 않는 것이 정확도보다 중요하다 —
 * 틀린 문장이 그대로 영실이의 근거가 되고, 수강생 답변에 인용된다.
 */
@Service
public class AnnotationHighlightDescriber {

    private static final String TOOL_NAME = "describe_highlight";

    private static final String PROMPT = """
            강사가 강의 화면의 한 부분을 <b>강조 표시</b>했습니다. 그 부분이 무엇인지 설명하세요.

            규칙:
            - 강조 표시(색이 다른 손그림 획)가 <b>가리키는 대상</b>을 설명하세요. 표시 자체(동그라미·밑줄)를
              설명하지 마세요.
            - 화면에 <b>글자가 있으면 그대로 옮기세요.</b> 요약하지 말고 원문을 씁니다 — 나중에 이 문장으로
              검색합니다.
            - 도표·그림이면 무엇을 나타내는지 적으세요.
            - <b>보이지 않는 것을 지어내지 마세요.</b> 흐릿하거나 가려서 읽을 수 없으면 readable을 false로
              두고 text는 비웁니다. 추측한 문장이 그대로 학생 답변의 근거가 됩니다.
            - 한국어로 씁니다.
            """;

    private static final String TOOL_PARAMETERS = """
            {
              "type": "object",
              "properties": {
                "text": {
                  "type": "string",
                  "description": "강조된 부분의 내용. 화면의 글자는 원문 그대로."
                },
                "readable": {
                  "type": "boolean",
                  "description": "읽을 수 있었는가. false면 text는 빈 문자열."
                }
              },
              "required": ["text", "readable"]
            }
            """;

    private final AnnotationVisionModel model;
    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    public AnnotationHighlightDescriber(AnnotationVisionModel model) {
        this.model = model;
    }

    /**
     * 이미지를 읽어 설명 문장을 만든다.
     *
     * @param imageUrl 모델이 GET할 수 있는 URL(호출 직전 발급한 presigned)
     * @return 읽지 못했으면 {@code null}. 빈 문자열이 아니라 null이다 — "읽었는데 아무것도 없다"와
     *         "읽지 못했다"는 다르고, 후자를 색인하면 빈 근거가 검색에 걸린다.
     */
    public String describe(String imageUrl) {
        String answer = model.callToolWithImageUrl(PROMPT, imageUrl, TOOL_NAME, TOOL_PARAMETERS);
        if (answer == null || answer.isBlank()) {
            throw new AnnotationInterpretException("모델이 강조 설명을 돌려주지 않았습니다.");
        }
        JsonNode parsed;
        try {
            parsed = jsonMapper.readTree(answer);
        } catch (RuntimeException e) {
            throw new AnnotationInterpretException("강조 설명을 해석하지 못했습니다.", e);
        }
        if (!parsed.path("readable").asBoolean(false)) {
            return null;
        }
        String text = parsed.path("text").asString("").trim();
        return text.isEmpty() ? null : text;
    }
}
