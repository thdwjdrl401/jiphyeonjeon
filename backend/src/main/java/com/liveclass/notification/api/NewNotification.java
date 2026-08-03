package com.liveclass.notification.api;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 만들 알림 하나. 발행 지점(2단계 이후의 이벤트 리스너·팬아웃 워커)이 채워 넘긴다.
 *
 * <p><b>문구가 완성된 채로 온다.</b> 저장 시점에 문장을 굳히는 것이 이 설계의 선택이다(ADR-0073 §7) —
 * 알림은 그때 일어난 일의 기록이고, 목록 조회가 단일 테이블 읽기가 되어야 60초 폴링을 견딘다.
 *
 * <p>{@code readStatus}는 받지 않는다. 새 알림은 언제나 안 읽은 상태다.
 */
public record NewNotification(
        UUID recipientId,
        String type,
        String actionStatus,
        String severity,
        String title,
        String message,
        /** 리소스 id 묶음의 JSON. 서버가 해석하지 않고 그대로 저장한다. */
        String targetsJson,
        String groupKey,
        /** {type}:{recipientId}:{리소스}. 같은 사건의 재발행을 DB가 한 건으로 접는다. */
        String dedupeKey,
        OffsetDateTime previousStartsAt,
        OffsetDateTime nextStartsAt
) {

    /** 일정 변경이 아닌 보통의 알림. */
    public static NewNotification of(UUID recipientId, String type, String actionStatus, String severity,
                                     String title, String message, String targetsJson,
                                     String groupKey, String dedupeKey) {
        return new NewNotification(recipientId, type, actionStatus, severity, title, message,
                targetsJson, groupKey, dedupeKey, null, null);
    }
}
