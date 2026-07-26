package com.liveclass.aiintegration.api;

/**
 * 다른 모듈이 AI 배치 잡을 outbox에 싣는 포트(ADR-0036, CONTRACT §3-1). 도메인 변경과 <b>같은 트랜잭션</b>에서
 * 호출해 발행 신뢰성을 얻는다 — 실제 RabbitMQ 발행은 릴레이가 별도로 한다. outbox 엔티티·리포는 이 모듈 내부.
 */
public interface OutboxPublisher {

    /**
     * outbox_events에 잡 1건을 PENDING으로 기록한다. {@code idempotencyKey}는 UNIQUE라 같은 키를 다시
     * 넣으면 조용히 무시한다(멱등) — 중복 발행 방지가 outbox의 존재 이유다.
     *
     * @param aggregateType 발생 애그리거트(예: material_asset)
     * @param aggregateId   애그리거트 id(문자열)
     * @param eventType     이벤트 타입(예: MATERIAL_EMBED_REQUESTED)
     * @param payloadJson   잡 페이로드(JSON 문자열, CONTRACT §3-1 envelope)
     * @param idempotencyKey 중복 발행 방지 키(UNIQUE)
     * @param correlationId 서비스 간 추적 id(없으면 null)
     */
    void enqueue(String aggregateType, String aggregateId, String eventType,
                 String payloadJson, String idempotencyKey, String correlationId);
}
