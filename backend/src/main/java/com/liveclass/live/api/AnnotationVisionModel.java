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
}
