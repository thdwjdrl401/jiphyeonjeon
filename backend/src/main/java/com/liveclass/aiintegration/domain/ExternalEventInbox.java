package com.liveclass.aiintegration.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
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
@Table(schema = "core", name = "external_event_inbox")
@IdClass(ExternalEventInboxId.class)
@Getter
@Setter
@NoArgsConstructor
public class ExternalEventInbox {

    @Id
    private String source;

    @Id
    private String sourceEventId;

    private String eventType;

    private String aggregateRef;

    @JdbcTypeCode(SqlTypes.JSON)
    private String payloadJson;

    @Enumerated(EnumType.STRING)
    private InboxStatus status;

    private OffsetDateTime receivedAt;

    private OffsetDateTime processedAt;

    private String errorDetail;

    @CreationTimestamp
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    private OffsetDateTime updatedAt;
}
