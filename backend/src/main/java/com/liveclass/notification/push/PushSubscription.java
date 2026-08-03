package com.liveclass.notification.push;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 브라우저 하나의 Web Push 구독. <b>기기당 한 행</b>이다 — 같은 사람이 PC·폰을 쓰면 둘이 생기고,
 * 알림도 둘 다로 간다(PC에서 읽어도 폰 알림은 사라지지 않는다).
 */
@Entity
@Table(schema = "core", name = "push_subscription")
@Getter
@Setter
@NoArgsConstructor
public class PushSubscription {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    private UUID userId;

    /** 푸시 서비스가 준 주소. 이게 기기 식별자다. */
    private String endpoint;

    /** 페이로드 암호화 키. <b>비밀이므로 응답에 나가면 안 된다.</b> */
    private String p256dh;

    /** 페이로드 인증 시크릿. 같이 비밀이다. */
    private String auth;

    private String userAgent;

    @CreationTimestamp
    private OffsetDateTime createdAt;

    private OffsetDateTime lastSuccessAt;
}
