package com.liveclass.notification.push;

import org.springframework.data.jpa.repository.JpaRepository;

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
}
