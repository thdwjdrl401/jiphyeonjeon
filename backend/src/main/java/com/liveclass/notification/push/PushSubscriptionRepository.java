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
     *
     * <p><b>명단은 배열로 넘긴다</b> — 아래 {@link #markDelivered}와 같은 이유다(ADR-0137).
     */
    @Modifying
    @Query(value = """
            DELETE FROM core.push_subscription
             WHERE id = ANY(:ids)
            """, nativeQuery = true)
    int deleteAllByIds(@Param("ids") UUID[] ids);

    /**
     * 성공한 구독의 마지막 성공 시각을 <b>한 문장</b>으로 갱신한다. {@code saveAll}은 바뀐 것이
     * 시각 한 칸뿐인데 넓은 행(암호화 키 포함) 전체를 성공 수만큼 다시 썼다.
     *
     * <p><b>명단을 IN 목록이 아니라 배열로 넘긴다.</b> IN이면 파라미터가 명단 크기만큼 생기고,
     * 크기마다 다른 문장이 되어 계획 캐시가 쪼개진다 — 100만 명 회차에서 이 한 메서드가
     * {@code pg_stat_statements}에 <b>105종</b>으로 흩어져 있었다(ADR-0137). 배열이면 하나다.
     *
     * <p>JPQL에는 배열 비교가 없어 네이티브로 내려간다. 엔티티를 거치지 않는 벌크 문장이라
     * ({@code @Modifying}) 잃는 것이 없다.
     *
     * <p>여기는 {@code settle}과 달리 <b>자르지 않는다.</b> 이 두 문장은 결과 반영 트랜잭션
     * 안에서 함께 돌아 이미 전부 아니면 전무이고, 문장을 하나로 줄여도 그 성질이 그대로다.
     */
    @Modifying
    @Query(value = """
            UPDATE core.push_subscription
               SET last_success_at = :at
             WHERE id = ANY(:ids)
            """, nativeQuery = true)
    int markDelivered(@Param("ids") UUID[] ids, @Param("at") OffsetDateTime at);
}
