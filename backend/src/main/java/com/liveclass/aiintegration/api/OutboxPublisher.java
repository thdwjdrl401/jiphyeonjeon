package com.liveclass.aiintegration.api;

import java.time.Duration;

/**
 * 다른 모듈이 AI 배치 잡을 outbox에 싣는 포트(ADR-0036, CONTRACT §3-1). 도메인 변경과 <b>같은 트랜잭션</b>에서
 * 호출해 발행 신뢰성을 얻는다 — 실제 RabbitMQ 발행은 릴레이가 별도로 한다. outbox 엔티티·리포는 이 모듈 내부.
 */
public interface OutboxPublisher {

    /**
     * outbox_events에 잡 1건을 PENDING으로 기록한다. {@code idempotencyKey}는 UNIQUE라 같은 키를 다시
     * 넣으면 조용히 무시한다(멱등) — 중복 발행 방지가 outbox의 존재 이유다.
     *
     * @param destination   실려 갈 목적지(큐 이름). {@link OutboxDestinations} 참고 —
     *                      기본값이 없으므로 <b>반드시</b> 넘겨야 한다. 목적지를 빠뜨린 이벤트가
     *                      조용히 AI 큐로 흘러가면 엉뚱한 워커가 그 메시지를 받는다.
     * @param aggregateType 발생 애그리거트(예: material_asset)
     * @param aggregateId   애그리거트 id(문자열)
     * @param eventType     이벤트 타입(예: MATERIAL_EMBED_REQUESTED)
     * @param payloadJson   잡 페이로드(JSON 문자열, CONTRACT §3-1 envelope)
     * @param idempotencyKey 중복 발행 방지 키(UNIQUE)
     * @param correlationId 서비스 간 추적 id(없으면 null)
     */
    default void enqueue(String destination, String aggregateType, String aggregateId, String eventType,
                         String payloadJson, String idempotencyKey, String correlationId) {
        enqueueAfter(destination, aggregateType, aggregateId, eventType,
                payloadJson, idempotencyKey, correlationId, Duration.ZERO);
    }

    /**
     * {@link #enqueue}와 같되 <b>지금 발행하지 않는다</b>. 릴레이는 {@code next_attempt_at}이 지난
     * 행만 집으므로, 그 시각을 앞당기지 않고 미루는 것으로 지연이 된다.
     *
     * <p>필요해진 계기는 푸시의 429다(ADR-0128). 푸시 서비스가 "속도를 줄여라"라고 답한 직후에
     * 같은 명단을 다시 실으면, 커밋이 릴레이를 곧바로 깨우므로(ADR-0122) 밀리초 안에 같은 곳을
     * 다시 두드린다 — 상대가 말한 대기 시간을 그대로 무시하는 셈이다.
     *
     * @param delay 지금부터 이만큼 뒤에 발행 대상이 된다. {@code null}이나 음수는 지연 없음.
     */
    void enqueueAfter(String destination, String aggregateType, String aggregateId, String eventType,
                      String payloadJson, String idempotencyKey, String correlationId, Duration delay);
}
