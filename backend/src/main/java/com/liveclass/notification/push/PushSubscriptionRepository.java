package com.liveclass.notification.push;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface PushSubscriptionRepository extends JpaRepository<PushSubscription, UUID> {

    Optional<PushSubscription> findByEndpoint(String endpoint);

    List<PushSubscription> findByUserId(UUID userId);

    /** 팬아웃 한 조각의 수신자 전원의 기기를 한 번에. 사람마다 조회하면 조각 크기만큼 왕복이 생긴다. */
    List<PushSubscription> findByUserIdIn(Collection<UUID> userIds);

    void deleteByEndpointAndUserId(String endpoint, UUID userId);

    /**
     * 죽은 구독(404·410)을 <b>한 문장</b>으로 지운다. {@code deleteAll}은 엔티티마다 DELETE를
     * 만들었다 — 발송 배치의 만료 수만큼 왕복이 곱해진다.
     */
    @Modifying
    @Query("DELETE FROM PushSubscription s WHERE s.id IN :ids")
    int deleteAllByIds(@Param("ids") Collection<UUID> ids);

    /**
     * 성공한 구독의 마지막 성공 시각을 <b>한 문장</b>으로 갱신한다. {@code saveAll}은 바뀐 것이
     * 시각 한 칸뿐인데 넓은 행(암호화 키 포함) 전체를 성공 수만큼 다시 썼다.
     */
    @Modifying
    @Query("UPDATE PushSubscription s SET s.lastSuccessAt = :at WHERE s.id IN :ids")
    int markDelivered(@Param("ids") Collection<UUID> ids, @Param("at") OffsetDateTime at);
}
