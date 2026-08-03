package com.liveclass.notification.repository;

import com.liveclass.notification.domain.Notification;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

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
     */
    @Query("""
            SELECT n FROM Notification n
            WHERE n.recipientId = :recipientId
              AND (:actionStatus IS NULL OR n.actionStatus = :actionStatus)
              AND (:readStatus IS NULL OR n.readStatus = :readStatus)
            ORDER BY n.createdAt DESC, n.id DESC
            """)
    Page<Notification> findMine(@Param("recipientId") UUID recipientId,
                                @Param("actionStatus") String actionStatus,
                                @Param("readStatus") String readStatus,
                                Pageable pageable);

    /**
     * 배지 개수는 <b>필터와 무관한 전체 기준</b>이다(§2-4). 두 개수를 한 문장에 묶지 않는 이유는
     * 부분 인덱스를 쓰기 위해서다 — {@code FILTER}로 묶으면 그 사람의 알림을 전부 훑는다.
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

    Optional<Notification> findByIdAndRecipientId(UUID id, UUID recipientId);

    Optional<Notification> findByDedupeKey(String dedupeKey);
}
