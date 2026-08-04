package com.liveclass.aiintegration.api;

import java.util.UUID;

/**
 * AI가 강조 캡처를 색인한 결과(ADR-0074).
 *
 * <p><b>왜 포트가 아니라 이벤트인가.</b> live는 색인 잡을 싣기 위해 이미 aiintegration을 참조한다
 * ({@code OutboxPublisher}). 여기서 aiintegration이 live의 포트를 부르면 두 모듈이 서로를 참조해
 * 순환이 된다 — ModularityTests가 그것을 막는다. 이벤트로 알리면 방향이 하나로 남는다:
 * live → aiintegration.
 *
 * @param highlightId 캡처 식별자
 * @param status      {@code PROCESSING}·{@code READY}·{@code FAILED}
 */
public record AnnotationIndexResult(UUID highlightId, String status) {
}
