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

    // 스코프는 정확히 하나만 채워진다(DB ck_material_scope, ADR-0042). 레슨 자료면 lessonId,
    // 커리큘럼 자료면 curriculumId. 나머지는 null.
    private UUID lessonId;

    private UUID curriculumId;

    private UUID assetId;

    @Enumerated(EnumType.STRING)
    private MaterialStatus status;

    // 임베딩 파이프라인 상태(ADR-0036). 연결 상태와 직교. 신규 연결은 서비스가 세팅, 기존 행은 READY 승계.
    @Enumerated(EnumType.STRING)
    private MaterialEmbeddingStatus embeddingStatus;

    // 핵심 용어 추출 상태(ADR-0010). 임베딩이 READY여도 용어는 EMPTY/FAILED일 수 있다.
    @Enumerated(EnumType.STRING)
    private MaterialKeyTermStatus keyTermStatus;

    @CreationTimestamp
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    private OffsetDateTime updatedAt;
}
