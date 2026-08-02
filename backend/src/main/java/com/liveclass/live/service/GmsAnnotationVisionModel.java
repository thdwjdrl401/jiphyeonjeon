package com.liveclass.live.service;

import com.liveclass.live.api.AnnotationVisionModel;
import com.liveclass.live.config.AnnotationAiProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;

/**
 * GMS 게이트웨이 어댑터(ADR-0054 결정 7). OpenAI 호환 {@code /chat/completions}에 이미지 파트와
 * 툴 스키마를 실어 보내고, 툴콜 인자만 뽑아 돌려준다.
 *
 * <p><b>ai-api를 거치지 않는다.</b> 이 호출에는 검색도 임베딩도 자막 컨텍스트도 없어 파이썬이 할
 * 도메인 일이 없다. RAG 컨텍스트가 필요해지면 그때 옮기며, 그때도 FE 계약(§3-6e)은 그대로다.
 *
 * <p>{@code tool_choice}로 함수를 <b>지목</b>한다. {@code auto}로 두면 모델이 툴 대신 산문으로
 * 답하는 경우가 생기는데, 그러면 우리가 파싱할 것이 없다.
 */
@Component
class GmsAnnotationVisionModel implements AnnotationVisionModel {

    private static final Logger log = LoggerFactory.getLogger(GmsAnnotationVisionModel.class);

    private final AnnotationAiProperties properties;
    private final HttpClient httpClient;
    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    GmsAnnotationVisionModel(AnnotationAiProperties properties) {
        this.properties = properties;
        this.httpClient = HttpClient.newBuilder().connectTimeout(properties.connectTimeout()).build();
    }

    @Override
    public String callTool(String prompt, String imageDataUri, String toolName, String toolParameters) {
        if (!properties.enabled()) {
            throw new AnnotationInterpretException("판서 해석이 설정되지 않았습니다(GMS 키 없음).");
        }
        byte[] body = requestBody(prompt, imageDataUri, toolName, toolParameters);
        if (body.length > properties.maxImageBytes() + 8192) {
            throw new AnnotationInterpretException("판서 이미지가 너무 큽니다.");
        }

        HttpRequest request = HttpRequest.newBuilder(properties.chatCompletionsUri())
                .timeout(properties.requestTimeout())
                .header("Authorization", "Bearer " + properties.apiKey())
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofByteArray(body))
                .build();

        HttpResponse<String> response;
        try {
            response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        } catch (IOException e) {
            throw new AnnotationInterpretException("판서 해석 요청을 보내지 못했습니다.", e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AnnotationInterpretException("판서 해석이 중단됐습니다.", e);
        }

        if (response.statusCode() / 100 != 2) {
            /*
             * <b>사유를 남긴다.</b> 예전에는 상태코드만 찍었는데, 그러면 400이 왔을 때 "무엇이
             * 잘못됐는지"를 밖에서 알 방법이 없다 — 실제로 이미지가 커서 나는 400인지 다른
             * 이유인지 가리지 못해 추측으로 시간을 썼다.
             *
             * <p>본문은 <b>앞부분만</b> 남긴다. 오류 메시지는 앞에 오고, 길게 남기면 로그가 부풀거나
             * 우리가 보낸 내용이 되비쳐 들어올 수 있다. 우리가 보낸 프롬프트·이미지는 절대 찍지 않는다.
             */
            log.warn("판서 해석 상류 실패 status={} reason={}",
                    response.statusCode(), summarize(response.body()));
            throw new AnnotationInterpretException("판서 해석 모델이 응답하지 않았습니다: " + response.statusCode());
        }

        JsonNode parsed;
        try {
            parsed = jsonMapper.readTree(response.body());
        } catch (RuntimeException e) {
            throw new AnnotationInterpretException("판서 해석 응답을 해석하지 못했습니다.", e);
        }

        JsonNode toolCalls = parsed.path("choices").path(0).path("message").path("tool_calls");
        if (!toolCalls.isArray() || toolCalls.isEmpty()) {
            return null;   // 툴을 부르지 않았다 — 호출자가 "읽지 못함"으로 처리한다
        }
        return toolCalls.path(0).path("function").path("arguments").asString(null);
    }

    /**
     * 상류 오류 본문에서 사유만 짧게 뽑는다.
     *
     * <p>앞부분만 남긴다 — 오류 메시지는 앞에 오고, 길게 남기면 로그가 부풀거나 우리가 보낸 내용이
     * 되비쳐 들어올 수 있다. 우리가 보낸 프롬프트·이미지는 절대 찍지 않는다.
     */
    private static String summarize(String body) {
        if (body == null || body.isBlank()) {
            return "(본문 없음)";
        }
        String trimmed = body.strip();
        return trimmed.length() > 300 ? trimmed.substring(0, 300) + "…" : trimmed;
    }

    private byte[] requestBody(String prompt, String imageDataUri, String toolName, String toolParameters) {
        var root = jsonMapper.createObjectNode();
        root.put("model", properties.model());
        // 같은 판서에 늘 같은 해석이 나오게 한다. 강사가 다시 눌렀을 때 답이 흔들리면 신뢰를 잃는다.
        root.put("temperature", 0);
        root.put("max_tokens", 800);

        var content = jsonMapper.createArrayNode();
        content.addObject().put("type", "text").put("text", prompt);
        content.addObject().put("type", "image_url")
                .putObject("image_url").put("url", imageDataUri);
        root.putArray("messages").addObject().put("role", "user").set("content", content);

        var function = jsonMapper.createObjectNode();
        function.put("name", toolName);
        function.set("parameters", jsonMapper.readTree(toolParameters));
        root.putArray("tools").addObject().put("type", "function").set("function", function);

        // 함수를 지목한다 — auto면 산문으로 답해 파싱할 것이 없어지는 경우가 있다.
        var choice = jsonMapper.createObjectNode();
        choice.put("type", "function");
        choice.putObject("function").put("name", toolName);
        root.set("tool_choice", choice);

        return jsonMapper.writeValueAsBytes(root);
    }
}
