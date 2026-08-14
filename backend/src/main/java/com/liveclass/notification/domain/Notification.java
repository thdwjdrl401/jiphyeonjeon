package com.liveclass.notification.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 알림 한 건. <b>수신자별로 한 행</b>이다(fan-out on write, ADR-0073).
 *
 * <p><b>읽음 축과 처리 축을 합치지 않는다.</b> {@code readStatus}는 "봤는가",
 * {@code actionStatus}는 "처리했는가"다. 읽음 처리는 처리 축을 <b>절대</b> 건드리지 않는다 —
 * 강사가 수강 신청 알림을 읽어도 승인·거절 전까지 할 일로 남아야 하고, 합치면 "처리 대기" 목록이
 * 성립하지 않는다.
 *
 * <p><b>문구는 사건당 한 행({@link NotificationContent})에 있다</b>(ADR-0123). 이 행에는 수신자별로
 * 정말 다른 값(누구에게, 두 상태 축, 시각들)만 남는다 — 같은 문장을 수신자 수만큼 저장하지 않기
 * 위해서다. 읽는 쪽 코드가 문구의 위치를 몰라도 되도록 문구 접근자는 content로 위임한다.
 *
 * <p><b>dedupe_key가 여기 없다.</b> 표가 월 파티션이라 파티션 키 없는 전역 유니크를 걸 수 없고,
 * 중복 제거는 월을 넘어야 한다(재공개가 다시 알리지 않음). 그 역할은 전역 등록표
 * {@code core.notification_dedupe}가 한다 — 넣는 쪽 CTE가 등록표를 먼저 통과시킨다.
 */
@Entity
@Table(schema = "core", name = "notification")
@Getter
@Setter
@NoArgsConstructor
public class Notification {

    @Id
    private UUID id;

    private UUID recipientId;

    /**
     * 사건 문구. EAGER인 이유는 이 엔티티를 문구 없이 쓰는 자리가 없어서다 — 목록·단건·재판정
     * 모두 제목이나 targets를 읽는다. open-in-view가 꺼져 있어(application.yml) LAZY로 두면
     * 트랜잭션 밖 응답 조립에서 터진다. 목록 경로는 N+1을 피하려고 JPQL이 fetch join을 명시한다.
     */
    @ManyToOne(fetch = FetchType.EAGER)
    @JoinColumn(name = "content_id")
    private NotificationContent content;

    private String readStatus;

    private String actionStatus;

    private OffsetDateTime createdAt;

    private OffsetDateTime readAt;

    private OffsetDateTime completedAt;

    // ---- 문구 위임 ----
    // 읽는 쪽(응답 조립·대상 재판정)은 문구가 어느 표에 있는지 몰라야 한다. 정규화는 저장 구조의
    // 사정이지 도메인의 사정이 아니다.

    /** 계약이 정한 12개 고정 union(§2-4). 문자열로 두는 것은 경계에서 enum을 노출하지 않기 위해서다. */
    public String getType() {
        return content.getType();
    }

    public String getSeverity() {
        return content.getSeverity();
    }

    public String getTitle() {
        return content.getTitle();
    }

    public String getMessage() {
        return content.getMessage();
    }

    /** 리소스 id 묶음. JSON 문자열 그대로 — 서버가 해석하지 않는다. */
    public String getTargets() {
        return content.getTargets();
    }

    public String getGroupKey() {
        return content.getGroupKey();
    }

    /** 일정 변경 알림의 변경 전·후. "언제에서 언제로"가 없으면 그 알림은 쓸모가 없다. */
    public OffsetDateTime getPreviousStartsAt() {
        return content.getPreviousStartsAt();
    }

    public OffsetDateTime getNextStartsAt() {
        return content.getNextStartsAt();
    }
}
