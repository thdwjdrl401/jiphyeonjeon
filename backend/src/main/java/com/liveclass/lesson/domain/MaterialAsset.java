package com.liveclass.lesson.domain;

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
@Table(schema = "core", name = "material_asset")
@Getter
@Setter
@NoArgsConstructor
public class MaterialAsset {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    private UUID lessonId;

    private UUID assetId;

    @Enumerated(EnumType.STRING)
    private MaterialStatus status;

    // 임베딩 파이프라인 상태(ADR-0036). 연결 상태와 직교. 신규 연결은 서비스가 세팅, 기존 행은 READY 승계.
    @Enumerated(EnumType.STRING)
    private MaterialEmbeddingStatus embeddingStatus;

    @CreationTimestamp
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    private OffsetDateTime updatedAt;
}
