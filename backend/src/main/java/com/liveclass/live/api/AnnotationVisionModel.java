package com.liveclass.live.api;

/**
 * 판서 이미지를 읽어 <b>툴콜 인자 JSON</b>을 돌려주는 모델(ADR-0054).
 *
 * <p>전송(어느 게이트웨이에 어떤 헤더로 보내는가)과 해석(무엇을 묻고 무엇을 받아들이는가)을
 * 가르는 자리다. 해석 쪽 규칙 — 스키마 검증, `replace` 범위 확인 — 은 실제 모델 없이 테스트할 수
 * 있어야 한다.
 */
public interface AnnotationVisionModel {

    /**
     * @param prompt         모델에게 줄 지시
     * @param imageDataUri   {@code data:image/png;base64,...}
     * @param toolName       강제로 부르게 할 함수 이름
     * @param toolParameters 그 함수의 JSON Schema(파라미터 부분)
     * @return 모델이 만든 인자 JSON. 모델이 툴을 부르지 않았으면 {@code null}
     */
    String callTool(String prompt, String imageDataUri, String toolName, String toolParameters);

    /**
     * 이미 <b>공개적으로 읽을 수 있는 URL</b>이 있을 때 쓴다(ADR-0074).
     *
     * <p>강조 캡처는 브라우저가 아니라 저장된 에셋에서 온다. presigned URL이 이미 공개 도메인으로
     * 서명돼 있어(nginx가 프록시) 모델이 그대로 가져갈 수 있다 — 바이트를 서버로 내렸다가 다시
     * 임시 저장소에 올리는 왕복이 불필요하다.
     *
     * @param imageUrl 모델이 GET할 수 있는 URL. 만료될 수 있으므로 호출 직전에 발급한 것을 준다.
     */
    String callToolWithImageUrl(String prompt, String imageUrl, String toolName, String toolParameters);
}
