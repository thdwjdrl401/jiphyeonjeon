package com.liveclass.learning.domain;

import jakarta.persistence.Entity;
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
import java.util.UUID;

@Entity
@Table(schema = "core", name = "learning_progress")
@Getter
@Setter
@NoArgsConstructor
public class LearningProgress {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private UUID userId;

    private UUID lessonId;

    // NOT NULL DEFAULT 0/[] 컬럼 — DB 기본값은 컬럼 미지정 INSERT에만 적용되므로, JPA가 값을 실어
    // 보내도 위반되지 않도록 엔티티 기본값을 둔다(새 행의 첫 저장).
    private Long lastPositionMs = 0L;

    private Integer progressPercent = 0;

    @JdbcTypeCode(SqlTypes.JSON)
    private String watchedRanges = "[]";

    private OffsetDateTime completedAt;

    private OffsetDateTime clientUpdatedAt;

    @CreationTimestamp
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    private OffsetDateTime updatedAt;
}
