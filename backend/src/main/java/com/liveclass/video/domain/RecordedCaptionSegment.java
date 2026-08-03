package com.liveclass.video.domain;

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

@Entity
@Table(schema = "core", name = "recorded_caption_segment")
@Getter
@Setter
@NoArgsConstructor
public class RecordedCaptionSegment {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    private UUID trackId;
    private UUID jobId;
    private int chunkIndex;
    private int localSegmentIndex;
    private long startMs;
    private long endMs;
    private String text;

    @CreationTimestamp
    private OffsetDateTime createdAt;
}
