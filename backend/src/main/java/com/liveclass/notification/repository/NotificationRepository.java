package com.liveclass.notification.repository;

import com.liveclass.notification.domain.Notification;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;

public interface NotificationRepository extends JpaRepository<Notification, UUID> {

    /**
     * 내 알림 목록. 두 축을 <b>AND로 겹친다</b> — 하나의 enum으로 묶으면 "처리 대기 중 아직 안 읽은
     * 것"을 물어볼 수 없다. 각 축은 null이면 그 축으로 가리지 않는다.
     *
     * <p>필터 조합이 넷이지만 인덱스를 넷 두지 않는다. 한 사람의 알림은 많아야 수천 건이라
     * {@code (recipient_id, created_at DESC)} 하나로 좁힌 뒤 걸러도 충분하고, 조합마다 인덱스를 두면
     * 쓰기가 그만큼 느려진다.
     *
     * <p>문구는 content에 있다(ADR-0123). <b>fetch join으로 한 문장에 가져온다</b> — 없으면 페이지
     * 크기만큼 content 조회가 따라붙는다(N+1). 페이지 카운트는 fetch join을 셀 수 없으므로 따로 쓴다.
     */
    @Query(value = """
            SELECT n FROM Notification n JOIN FETCH n.content
            WHERE n.recipientId = :recipientId
              AND (:actionStatus IS NULL OR n.actionStatus = :actionStatus)
              AND (:readStatus IS NULL OR n.readStatus = :readStatus)
            ORDER BY n.createdAt DESC, n.id DESC
            """,
            countQuery = """
            SELECT count(n) FROM Notification n
            WHERE n.recipientId = :recipientId
              AND (:actionStatus IS NULL OR n.actionStatus = :actionStatus)
              AND (:readStatus IS NULL OR n.readStatus = :readStatus)
            """)
    Page<Notification> findMine(@Param("recipientId") UUID recipientId,
                                @Param("actionStatus") String actionStatus,
                                @Param("readStatus") String readStatus,
                                Pageable pageable);

    /**
     * 배지 개수는 <b>필터와 무관한 전체 기준</b>이다(§2-4). 두 개수를 한 문장에 묶지 않는 이유는
     * 부분 인덱스를 쓰기 위해서다 — {@code FILTER}로 묶으면 그 사람의 알림을 전부 훑는다.
     * content와 무관한 경로라 정규화(ADR-0123) 뒤에도 단일 테이블 읽기 그대로다.
     */
    long countByRecipientIdAndReadStatus(UUID recipientId, String readStatus);

    long countByRecipientIdAndActionStatus(UUID recipientId, String actionStatus);

    /**
     * 개별 읽음. <b>{@code recipientId}를 조건에 넣는 것이 인가다</b> — 남의 알림은 0행이 갱신되어
     * 그대로 404가 된다. 소유자를 따로 조회해 비교할 필요가 없고, 403을 주지 않으니 그 알림의
     * 존재도 새지 않는다.
     *
     * <p>처리 축({@code actionStatus})을 건드리지 않는다.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
            UPDATE Notification n
               SET n.readStatus = 'READ', n.readAt = CURRENT_TIMESTAMP
             WHERE n.id = :id AND n.recipientId = :recipientId AND n.readStatus = 'UNREAD'
            """)
    int markRead(@Param("id") UUID id, @Param("recipientId") UUID recipientId);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
            UPDATE Notification n
               SET n.readStatus = 'READ', n.readAt = CURRENT_TIMESTAMP
             WHERE n.recipientId = :recipientId AND n.readStatus = 'UNREAD'
            """)
    int markAllRead(@Param("recipientId") UUID recipientId);

    /**
     * 수강 신청 알림의 <b>처리 축을 닫는다</b>. 승인·거절이면 {@code COMPLETED}, 학생이 스스로
     * 취소해 처리할 일 자체가 사라졌으면 {@code EXPIRED}로 부른다.
     *
     * <p>이 갱신이 없어서 강사의 "처리 대기" 배지가 승인 뒤에도 줄지 않았다. 눌러 봐야 그 자리에
     * 승인 대기 신청자가 없으니 강사가 내릴 방법도 없었다 — {@code COMPLETED}는 상수로만 있고
     * 아무도 쓰지 않는 값이었다.
     *
     * <p><b>수신자를 조건에 넣지 않는다.</b> 사용자 요청이 아니라 워커가 사건을 처리하며 부르는
     * 갱신이라 인가 주체가 없고, 한 수강 신청의 대기 알림은 담당 강사의 것뿐이다.
     *
     * <p>같은 수강 행이 재신청으로 되살아나면 대기 알림이 여러 건일 수 있어 <b>여러 행을 갱신한다</b>.
     * 되살아난 뒤의 <b>새</b> 대기 알림까지 닫아 버리지 않게 막는 것은 부르는 쪽의 수강 상태
     * 확인이다 — 시각으로 자르지 않는 이유는 팬아웃이 밀리면 알림 생성 시각이 결정 시각보다
     * 늦을 수 있기 때문이다.
     *
     * <p>종류와 targets는 content로 갔으므로(ADR-0123) 조인해서 거른다. 갱신되는 것은 여전히
     * 수신자별 행의 처리 축뿐이다 — content는 여러 행이 공유하니 절대 갱신하지 않는다.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = """
            UPDATE core.notification n
               SET action_status = :status,
                   completed_at = :settledAt
              FROM core.notification_content c
             WHERE c.id = n.content_id
               AND c.type = 'ENROLLMENT_REQUESTED'
               AND n.action_status = 'ACTION_REQUIRED'
               AND c.targets ->> 'enrollmentId' = :enrollmentId
            """, nativeQuery = true)
    int settleEnrollmentRequests(@Param("enrollmentId") String enrollmentId,
                                 @Param("status") String status,
                                 @Param("settledAt") OffsetDateTime settledAt);

    Optional<Notification> findByIdAndRecipientId(UUID id, UUID recipientId);
}
