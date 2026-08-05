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
 * <p><b>OCR이 아니라 서술을 요구한다</b>(ADR-0079 보강). "글자를 그대로 옮기라"고만 했더니 모델이
 * 화면의 글자를 <b>줄바꿈으로 나열</b>했다(운영 실측). 읽는 쪽은 화면을 볼 수 없으므로 항목만 늘어놓은
 * 텍스트로는 그것들이 서로 무슨 관계인지 알 수 없고, 그런 문장은 근거로 인용해도 뜻이 서지 않는다.
 * 그래서 <b>무엇에 관한 것인지 → 구성 요소와 관계</b>를 문장으로 쓰게 하고, 검색을 위해 고유명사·수치만
 * 원문 그대로 남기게 한다.
 *
 * <p><b>강조 표시가 이미지에 들어 있다.</b> 그것을 지우거나 무시하라고 하지 않는다. 어디를 봐야
 * 하는지 알려 주는 유일한 신호이기 때문이다(해석 경로는 반대로 빼야 한다 — 도형으로 오독된다).
 *
 * <p><b>이미지는 잘린 조각이 아니라 화면 전체다</b>(ADR-0079). 그래서 프롬프트가 <b>색</b>을 말한다 —
 * 크롭이 "여기를 보라"를 대신해 주던 것이 없어졌으므로, 주황색 획을 찾는 것이 첫 단계가 된다.
 * 색 상수는 FE의 {@code HIGHLIGHT_STROKE_COLOR}이고, 그 값을 바꾸면 이 프롬프트도 바꿔야 한다.
 *
 * <p><b>AI가 이 텍스트를 검증 없이 신뢰한다.</b> 그래서 지어내지 않는 것이 정확도보다 중요하다 —
 * 틀린 문장이 그대로 영실이의 근거가 되고, 수강생 답변에 인용된다.
 */
@Service
public class AnnotationHighlightDescriber {

    private static final String TOOL_NAME = "describe_highlight";

    private static final String PROMPT = """
            강의 화면 전체입니다. 강사가 이 화면의 한 부분에 <b>주황색(#f59f00) 반투명 손그림 획</b>으로
            강조 표시를 했습니다. 그 부분이 무엇을 설명하고 있는지를,
            <b>화면을 보지 못한 사람이 읽고 이해할 수 있게</b> 쓰세요.

            쓰는 방법:
            - <b>주황색 획을 먼저 찾으세요.</b> 그 획이 감싸거나 밑줄 친 <b>대상</b>을 설명합니다. 표시
              자체(동그라미·밑줄)를 설명하지 마세요.
            - <b>첫 문장에서 이 부분이 무엇에 관한 것인지 밝히세요</b>("…의 구조도", "…를 구하는 식",
              "…를 처리하는 코드"). 읽는 사람은 이 문장 하나로 볼지 말지 정한다.
            - 이어서 구성 요소를 <b>관계와 함께</b> 서술하세요. 화살표·포함·순서·연결이 있으면 말로
              옮깁니다("A가 B로 보낸다", "B는 C 안에 들어 있다", "①에서 ②로 이어진다").
            - <b>글자를 나열하기만 하면 안 됩니다.</b> 읽는 사람은 화면을 볼 수 없어서, 항목만 늘어놓으면
              그것들이 서로 무슨 관계인지 알 수 없습니다. 그런 문장은 근거로 쓸 수 없습니다.
            - 다만 <b>이름·수치·용어는 원문 그대로</b> 씁니다(고유명사, 함수·변수명, 숫자와 단위).
              이 단어로 검색하므로 우리말로 풀어 쓰거나 바꿔 쓰지 않습니다.
            - <b>화면 전체를 요약하지 마세요.</b> 주황색 획이 가리키는 곳 밖의 내용은 적지 않습니다.
              강사가 표시하지 않은 것까지 담으면 엉뚱한 질문에 이 화면이 근거로 끌려옵니다.
            - 빨간색 획은 <b>일반 판서</b>이지 강조가 아닙니다. 화면 가장자리의 검은 여백은 화면이 아닙니다.
            - <b>보이지 않는 것을 지어내지 마세요.</b> 주황색 획을 찾을 수 없거나, 흐릿하고 가려서 읽을 수
              없으면 readable을 false로 두고 text는 비웁니다. 추측한 문장이 그대로 학생 답변의 근거가 됩니다.
              일부만 흐리면 <b>읽은 것만</b> 쓰고 흐린 부분은 적지 않습니다.
            - 한국어로, <b>완결된 문장</b>으로 씁니다.
            """;

    private static final String TOOL_PARAMETERS = """
            {
              "type": "object",
              "properties": {
                "text": {
                  "type": "string",
                  "description": "강조된 부분이 무엇인지에 대한 설명. 구성 요소를 관계와 함께 문장으로 서술한다. 글자 나열이 아니다. 이름·수치·용어는 원문 그대로."
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
