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
@Table(schema = "core", name = "video_asset")
@Getter
@Setter
@NoArgsConstructor
public class VideoAsset {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    private UUID liveSessionId;

    private UUID lessonId;

    private String egressId;

    @Enumerated(EnumType.STRING)
    private VideoAssetStatus status;

    @Enumerated(EnumType.STRING)
    private ReplayStatus replayStatus;

    private String bucket;

    private String hlsManifestKey;

    private Long durationMs;

    private Long sizeBytes;

    private Integer segmentCount;

    private Long sessionOffsetMs;

    private OffsetDateTime recordingStartedAt;

    private OffsetDateTime recordingEndedAt;

    private OffsetDateTime readyAt;

    private String failureCode;

    private UUID publishedBy;

    private OffsetDateTime publishedAt;

    private String withdrawReason;

    private OffsetDateTime retentionUntil;

    @CreationTimestamp
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    private OffsetDateTime updatedAt;
}
