package com.liveclass.video.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Column;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(schema = "core", name = "recorded_stt_chunk")
@Getter
@Setter
@NoArgsConstructor
public class RecordedSttChunk {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    private UUID jobId;
    private int chunkIndex;
    private long sourceStartMs;
    private long sourceEndMs;
    @Column(length = 64)
    private String sourceSha256;
    @Column(length = 64)
    private String payloadSha256;
    private int segmentCount;
    private OffsetDateTime receivedAt;
}
