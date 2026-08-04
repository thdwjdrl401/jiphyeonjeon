package com.liveclass.video.domain;

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
import org.hibernate.annotations.UpdateTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(schema = "core", name = "recorded_stt_job")
@Getter
@Setter
@NoArgsConstructor
public class RecordedSttJob {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    private UUID recordedVideoId;
    private UUID sourceAssetId;
    private int attemptNo;

    @Enumerated(EnumType.STRING)
    private RecordedSttJobStatus status;

    private String idempotencyKey;
    private int publishAttemptCount;
    private OffsetDateTime nextPublishAt;
    private OffsetDateTime publishedAt;
    private Integer totalChunkCount;
    private int processedChunkCount;
    private String model;
    private String language;
    private String failureCode;
    private String lastError;
    private OffsetDateTime startedAt;
    private OffsetDateTime finishedAt;

    @CreationTimestamp
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    private OffsetDateTime updatedAt;
}
