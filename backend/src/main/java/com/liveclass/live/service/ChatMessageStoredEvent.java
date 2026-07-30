package com.liveclass.live.service;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 채팅 메시지가 실제로 DB에 저장됐을 때만 발행된다(멱등 재전송은 발행하지 않음).
 * 커밋 후({@code AFTER_COMMIT}) 리스너가 WebSocket으로 브로드캐스트한다 — 저장 안 된 것을 실시간으로
 * 흘리지 않기 위해. 엔티티가 아니라 값 스냅샷을 담아 커밋 이후 지연로딩 문제를 피한다.
 *
 * <p>브로드캐스트 payload에는 이름이 {@code alias} 하나로만 실린다 — 내부 userId는 담지 않는다.
 * {@code alias}는 발신자가 익명을 선택했으면 세션 한정 가명, 아니면 발신자가 스스로 지정한 표시 이름이다
 * (ADR-0050). "내 메시지" 판별은 라이브 중엔 FE가 자기 {@code clientMessageId} 에코로,
 * 콜드 복구는 REST GET의 {@code mine}으로 한다.
 */
public record ChatMessageStoredEvent(
        UUID sessionId,
        UUID lessonId,
        String messageId,
        String clientMessageId,
        String alias,
        long sessionMs,
        String text,
        boolean isQuestion,
        OffsetDateTime createdAt
) {
}
