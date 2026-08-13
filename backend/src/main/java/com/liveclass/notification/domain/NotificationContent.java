package com.liveclass.notification.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 알림 문구 원본. <b>사건당 1행</b>이고 수신자별 행({@link Notification})이 이 행을 가리킨다
 * (ADR-0123).
 *
 * <p>V23까지는 문구가 수신자별 행에 통째로 들어 있었다(ADR-0073 §7). 행 ~557B 중 57%가 넓은
 * 팬아웃에서 조각 전체 동일한 값이라 — 수강생 100만이면 같은 문장이 100만 번 저장된다 — 사건
 * 단위로 뽑아냈다. "만들 때 완성해 저장한다"는 성질은 이 행이 그대로 갖는다: 커리큘럼 이름이
 * 바뀌어도 그때 이름으로 남는다.
 *
 * <p>좁은 팬아웃(수강 사건)은 문구에 학생 이름이 들어가 <b>수신자당 1행</b>이 될 수 있다. 그래도
 * 구조를 가르지 않는다 — 경로가 두 벌이 되는 것보다 사건당 행 하나가 더 생기는 쪽이 싸다.
 *
 * <p><b>쓰기는 전부 네이티브 SQL이다</b>(삽입 리포지토리들의 CTE). 이 엔티티는 읽기 전용 매핑이라
 * setter가 없다.
 */
@Entity
@Table(schema = "core", name = "notification_content")
@Getter
@NoArgsConstructor
public class NotificationContent {

    @Id
    private UUID id;

    /** 계약이 정한 12개 고정 union(§2-4). */
    private String type;

    private String severity;

    private String title;

    private String message;

    /** 리소스 id 묶음. JSON 문자열 그대로 옮긴다 — 종류가 늘어도 스키마가 따라오지 않게. */
    @JdbcTypeCode(SqlTypes.JSON)
    private String targets;

    private String groupKey;

    /** 일정 변경 알림의 변경 전·후. */
    private OffsetDateTime previousStartsAt;

    private OffsetDateTime nextStartsAt;

    private OffsetDateTime createdAt;
}
