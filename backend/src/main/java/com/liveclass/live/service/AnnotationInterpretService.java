package com.liveclass.live.service;

import com.liveclass.live.api.AnnotationVisionModel;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * 손그림을 <b>의미</b>로 옮긴다(ADR-0054, CONTRACT §3-6e).
 *
 * <p><b>모델에게 좌표를 묻지 않는다.</b> 실측에서 모델이 낸 도형 좌표는 최대 96px(그림 크기의
 * 2~13%) 틀렸다. 같은 좌표를 우리는 획의 점에서 오차 없이 알고 있으므로 물을 이유가 없다. 대신
 * <b>좌표가 없는 중간 표현</b>만 받는다 — 다이어그램은 mermaid 정의, 수식은 LaTeX. 배치는
 * 클라이언트가 한다(mermaid는 dagre가, 수식은 원본 획의 bbox가 정한다).
 *
 * <p>도형 정리(사각형·원·직선)는 여기 오지 않는다. 그건 인식이 아니라 기하 계산이라 클라이언트가
 * 즉시·무료·결정론적으로 처리한다(ADR-0054 결정 4).
 */
@Service
public class AnnotationInterpretService {

    private static final Logger log = LoggerFactory.getLogger(AnnotationInterpretService.class);

    public static final String MODE_DIAGRAM = "diagram";
    public static final String MODE_MATH = "math";
    public static final String KIND_MERMAID = "mermaid";
    public static final String KIND_MATH = "math";

    /**
     * mermaid가 아는 다이어그램 선언. 정의는 반드시 이 중 하나로 시작해야 파싱된다.
     *
     * <p>실측에서 모델이 <b>3회 중 2회</b> 이 줄을 빼먹고 `A[요청] --> B[인증]`만 돌려줬다. 그러면
     * 클라이언트의 mermaid 파서가 예외를 내고 강사에게는 "정리한 결과를 넣지 못했습니다"로만 보인다.
     */
    private static final List<String> MERMAID_HEADERS = List.of(
            "flowchart", "graph", "sequenceDiagram", "classDiagram", "erDiagram",
            "stateDiagram-v2", "stateDiagram");

    /**
     * mermaid 정의에서 노드를 <b>{@code id[라벨]} 형식으로</b> 쓰게 한다. 실측에서 모델이
     * {@code 유정 --> 인증}처럼 라벨을 노드 id 자리에 바로 썼는데, 그러면 한글이 id가 되어 파서가
     * 걸리거나 라벨을 고칠 자리가 사라진다.
     */
    private static final String DIAGRAM_PROMPT = """
            이 손그림 다이어그램을 mermaid 정의로 옮기세요.

            규칙:
            - 정의는 반드시 `flowchart LR` 또는 `flowchart TD` 로 <b>시작</b>하세요.
            - 노드는 반드시 `A[라벨]`, `B{조건}` 처럼 <b>영문 id + 대괄호 라벨</b> 형식으로 쓰세요.
            - 박스 안 글자를 라벨로 그대로 옮기고, 화살표 방향을 지키세요.
            - 좌표나 크기는 쓰지 마세요. 배치는 이쪽에서 계산합니다.
            - 읽을 수 없으면 unreadable을 true로 두세요. 추측하지 마세요.
            """;

    private static final String DIAGRAM_TOOL = """
            {"type":"object","properties":{
              "definition":{"type":"string","description":"mermaid 정의 전체. 좌표를 담지 않는다."},
              "confidence":{"type":"number","minimum":0,"maximum":1},
              "unreadable":{"type":"boolean"}},
             "required":["definition","confidence","unreadable"]}""";

    private static final String MATH_PROMPT = """
            이 손글씨 수식을 읽으세요.

            - `latex`에는 LaTeX를 담으세요.
            - `plain`에는 그것을 <b>유니코드로 옮긴 것</b>을 담으세요. 예: `y = ax² + bx + c`.
              `^`, `_`, `\\frac` 같은 LaTeX 문법을 쓰지 말고 `²`, `√`, `∫`, `≤`, `π` 같은 글자를 쓰세요.
            - 읽을 수 없으면 unreadable을 true로 두세요. 추측하지 마세요.
            """;

    private static final String MATH_TOOL = """
            {"type":"object","properties":{
              "latex":{"type":"string","description":"수식만. 앞뒤 설명이나 $ 구분자를 넣지 않는다."},
              "plain":{"type":"string","description":"판서에 글자로 넣을 유니코드 수식. LaTeX 문법을 쓰지 않는다."},
              "confidence":{"type":"number","minimum":0,"maximum":1},
              "unreadable":{"type":"boolean"}},
             "required":["latex","plain","confidence","unreadable"]}""";

    private final AnnotationVisionModel model;
    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    public AnnotationInterpretService(AnnotationVisionModel model) {
        this.model = model;
    }

    /**
     * @param mode        {@link #MODE_DIAGRAM} 또는 {@link #MODE_MATH}
     * @param imageDataUri 강사가 선택한 영역만 렌더한 PNG
     * @param selectedIds 강사가 선택한 요소 id. <b>결과의 `replace`는 여기서만 나온다</b>
     */
    public AnnotationInterpretation interpret(String mode, String imageDataUri, List<String> selectedIds) {
        boolean diagram = MODE_DIAGRAM.equals(mode);
        if (!diagram && !MODE_MATH.equals(mode)) {
            throw new AnnotationInterpretException("알 수 없는 해석 모드입니다: " + mode);
        }
        String kind = diagram ? KIND_MERMAID : KIND_MATH;

        String arguments = model.callTool(
                diagram ? DIAGRAM_PROMPT : MATH_PROMPT,
                imageDataUri,
                diagram ? "to_mermaid" : "recognize_math",
                diagram ? DIAGRAM_TOOL : MATH_TOOL);

        // 모델이 툴을 부르지 않았다 — 읽지 못한 것으로 본다. 본문을 지어내는 것보다 낫다.
        if (arguments == null || arguments.isBlank()) {
            log.info("판서 해석: 모델이 툴을 부르지 않았다 mode={}", mode);
            return AnnotationInterpretation.unreadable(kind);
        }

        JsonNode parsed;
        try {
            parsed = jsonMapper.readTree(arguments);
        } catch (RuntimeException e) {
            throw new AnnotationInterpretException("모델 응답을 해석하지 못했습니다.", e);
        }

        if (parsed.path("unreadable").asBoolean(false)) {
            return AnnotationInterpretation.unreadable(kind);
        }

        // 수식은 판서에 <b>글자로</b> 들어간다. Excalidraw에는 수식 렌더러가 없고, 이미지로 넣으면
        // 데이터 채널로 파일이 흐르지 않아 수강생 화면에 나타나지 않는다(강사 화면 = 수강생 화면).
        // 그래서 넣을 것은 유니코드(`plain`)이고, LaTeX는 나중에 그래프·RAG에 쓰려고 함께 남긴다.
        String body = diagram
                ? normalizeMermaid(parsed.path("definition").asString(""))
                : parsed.path("plain").asString("").trim();
        String source = diagram ? "" : parsed.path("latex").asString("").trim();

        if (body.isEmpty()) {
            // unreadable을 세우지 않고 본문만 비워 보내는 경우가 있다. 빈 것은 못 읽은 것이다.
            return AnnotationInterpretation.unreadable(kind);
        }

        double confidence = clamp(parsed.path("confidence").asDouble(0.0));

        return new AnnotationInterpretation(kind, body, source, dedupe(selectedIds), confidence, false);
    }

    /**
     * mermaid 정의를 파서가 받아들일 형태로 다듬는다.
     *
     * <p><b>프롬프트만으로는 부족하다.</b> 다이어그램 선언(`flowchart LR` 등)을 반드시 넣으라고
     * 적어 두어도 실측에서 <b>3회 중 2회</b> 빠졌다. 없으면 클라이언트의 mermaid 파서가 예외를 내고
     * 강사에게는 "정리한 결과를 넣지 못했습니다"로만 보인다 — 무엇이 잘못됐는지 알 길이 없다.
     *
     * <p>코드펜스도 걷어낸다. 모델이 ```mermaid로 감싸 보내면 첫 줄이 선언이 아니게 된다.
     *
     * <p>선언이 없으면 `flowchart LR`을 얹는다. 손그림 다이어그램은 대개 왼쪽에서 오른쪽으로 흐르고,
     * 방향이 틀려도 강사가 확인 화면에서 보고 고칠 수 있다 — 아무것도 안 나오는 것보다 낫다.
     */
    static String normalizeMermaid(String raw) {
        if (raw == null) {
            return "";
        }
        String cleaned = raw.strip();
        if (cleaned.startsWith("```")) {
            cleaned = cleaned.replaceFirst("^```[a-zA-Z]*\\s*", "").replaceFirst("\\s*```$", "").strip();
        }
        if (cleaned.isEmpty()) {
            return "";
        }
        String firstLine = cleaned.lines().findFirst().orElse("").strip();
        boolean declared = MERMAID_HEADERS.stream().anyMatch(firstLine::startsWith);
        return declared ? cleaned : "flowchart LR\n" + cleaned;
    }

    /**
     * 지울 대상은 <b>강사가 선택한 것</b>이다.
     *
     * <p>모델에게 "어느 요소를 바꿀지" 맞히게 하지 않는다. 선택이 곧 범위이므로 모델이 엉뚱한 id를
     * 지목할 여지가 없고, 강사의 의도와 어긋날 수도 없다.
     */
    private static List<String> dedupe(List<String> ids) {
        if (ids == null || ids.isEmpty()) {
            return List.of();
        }
        Set<String> unique = new LinkedHashSet<>(ids);
        unique.removeIf(id -> id == null || id.isBlank());
        return List.copyOf(unique);
    }

    private static double clamp(double value) {
        if (Double.isNaN(value)) {
            return 0.0;
        }
        return Math.max(0.0, Math.min(1.0, value));
    }
}
