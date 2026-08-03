package com.liveclass.notification.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

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
 * <p><b>문구는 만들 때 완성해 저장한다.</b> 알림은 "지금 상태"가 아니라 그때 일어난 일의 기록이다.
 * 커리큘럼 이름이 바뀌어도 그때 이름으로 남는 편이 사실에 맞고, 무엇보다 목록 조회가 단일 테이블
 * 읽기가 된다 — 화면이 60초마다 개수를 물어보므로 이게 결정적이다.
 *
 * <p><b>{@code targets}를 해석하지 않는다.</b> 알림 종류마다 가리키는 리소스가 다르다(수강 신청은
 * enrollmentId·studentId, 녹화 완료는 lessonId·recordingId). 컬럼으로 펼치면 대부분이 NULL인 넓은
 * 표가 되고 종류가 늘 때마다 마이그레이션이 따라온다. <b>프론트 라우트 URL은 담지 않는다</b> —
 * 경로가 바뀌면 쌓인 알림이 전부 깨진다.
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

    /** 계약이 정한 12개 고정 union(§2-4). 문자열로 두는 것은 경계에서 enum을 노출하지 않기 위해서다. */
    private String type;

    private String readStatus;

    private String actionStatus;

    private String severity;

    private String title;

    private String message;

    /** 리소스 id 묶음. JSON 문자열 그대로 옮긴다 — 종류가 늘어도 스키마가 따라오지 않게. */
    @JdbcTypeCode(SqlTypes.JSON)
    private String targets;

    /** 나중에 "수강 신청 3건"처럼 묶기 위한 키. 뒤늦게 붙이면 이미 쌓인 알림은 묶을 수 없다. */
    private String groupKey;

    /**
     * 같은 사건이 두 번 들어와도 한 건만 남기는 지문. <b>응답에 노출하지 않는다.</b>
     *
     * <p>중복 방지는 DB의 unique 제약이 보장한다. 넣는 쪽은 {@code ON CONFLICT DO NOTHING}을 쓴다 —
     * "넣어 보고 중복 예외를 잡는" 방식은 못 쓴다(실패한 statement가 트랜잭션을 롤백 전용으로
     * 만들어 예외를 잡아도 커밋에서 다시 터진다).
     */
    private String dedupeKey;

    /** 일정 변경 알림의 변경 전·후. "언제에서 언제로"가 없으면 그 알림은 쓸모가 없다. */
    private OffsetDateTime previousStartsAt;

    private OffsetDateTime nextStartsAt;

    private OffsetDateTime createdAt;

    private OffsetDateTime readAt;

    private OffsetDateTime completedAt;
}
