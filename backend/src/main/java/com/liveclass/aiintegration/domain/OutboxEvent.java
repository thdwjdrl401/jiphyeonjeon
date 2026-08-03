package com.liveclass.aiintegration.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;

@Entity
@Table(schema = "core", name = "outbox_events")
@Getter
@Setter
@NoArgsConstructor
public class OutboxEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String aggregateType;

    private String aggregateId;

    private String eventType;

    /** 릴레이가 이 값을 라우팅 키로 써서 큐를 고른다. 코드에 박혀 있던 것을 데이터로 옮겼다(ADR-0073 §4). */
    private String destination;

    @JdbcTypeCode(SqlTypes.JSON)
    private String payloadJson;

    @Enumerated(EnumType.STRING)
    private OutboxStatus status;

    private String idempotencyKey;

    private String correlationId;

    private Integer attemptCount;

    private OffsetDateTime nextAttemptAt;

    private OffsetDateTime lockedAt;

    private String lockedBy;

    private String lastError;

    private OffsetDateTime publishedAt;

    @CreationTimestamp
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    private OffsetDateTime updatedAt;
}
