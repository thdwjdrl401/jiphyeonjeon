package com.liveclass.aiintegration.web.dto;

/**
 * AI 워커 → Spring 콜백(ADR-0036, CONTRACT §3-2). eventId로 멱등(inbox 복합키), eventType으로 분기.
 * 자료 임베딩: {@code MATERIAL_EMBEDDED}(성공) / {@code MATERIAL_EMBED_FAILED}(실패). outputs 등 미지의 필드는 무시.
 */
public record AiCallbackEvent(
        String eventId,
        String eventType,
        String jobId,
        String materialId,

        /** 강조 캡처 색인 결과일 때 온다(ADR-0074). 자료와 별개 축이라 필드를 나눈다. */
        String highlightId,
        String lessonId,
        String status,
        Outputs outputs
) {

    /** ADR-0010 v2 결과 메타데이터. 실제 용어 원문은 ai.material_key_term이 소유한다. */
    public record Outputs(
            Long materialVersionId,
            Integer chunkCount,
            KeyTermResult keyTermResult
    ) {
    }

    public record KeyTermResult(
            String status,
            Integer count,
            Boolean truncated,
            String failureCode
    ) {
    }
}
