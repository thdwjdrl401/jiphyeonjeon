package com.liveclass.video.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(schema = "core", name = "recorded_video")
@Getter
@Setter
@NoArgsConstructor
public class RecordedVideo {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    private UUID lessonId;

    private UUID clientRequestId;

    private UUID sourceAssetId;

    @Enumerated(EnumType.STRING)
    private RecordedVideoStatus status;

    private String outputBucket;

    private String hlsManifestKey;

    private Long durationMs;

    private Long sizeBytes;

    private Integer segmentCount;

    private String failureCode;

    private OffsetDateTime readyAt;

    @Version
    private long version;

    @CreationTimestamp
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    private OffsetDateTime updatedAt;
}
