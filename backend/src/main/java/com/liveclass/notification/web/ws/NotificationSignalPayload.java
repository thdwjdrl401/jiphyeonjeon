package com.liveclass.notification.web.ws;

import java.time.OffsetDateTime;

/**
 * 실시간 알림 신호. <b>내용이 아니라 "왔다"는 사실만</b> 담는다 — 화면은 이걸 받으면 목록과 개수를
 * 다시 읽는다({@link WsNotificationBroadcaster}에 그 이유가 있다).
 *
 * @param notificationType 무엇이 왔는지. 화면이 배지만 갱신할지 목록까지 열지 고르는 데 쓴다.
 */
public record NotificationSignalPayload(
        String notificationType,
        OffsetDateTime occurredAt
) {
}
