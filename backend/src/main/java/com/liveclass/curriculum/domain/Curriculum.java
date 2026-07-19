package com.liveclass.curriculum.domain;

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
import org.hibernate.annotations.DynamicUpdate;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * section_count·lesson_count·published_lesson_count는 DB 트리거가 소유한다(DDL 주석).
 * 앱은 이 컬럼들을 쓰지 않으며, @DynamicUpdate로 변경된 컬럼만 UPDATE해 트리거가 쓴 값을
 * stale in-memory 값으로 덮어쓰지 않도록 한다. structure_version만 앱이 유지한다.
 */
@Entity
@Table(schema = "core", name = "curriculum")
@DynamicUpdate
@Getter
@Setter
@NoArgsConstructor
public class Curriculum {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    private UUID instructorId;

    private String title;

    private String summary;

    private String description;

    private UUID thumbnailAssetId;

    @Enumerated(EnumType.STRING)
    private CurriculumLifecycleStatus lifecycleStatus;

    private OffsetDateTime startsAt;

    private OffsetDateTime endsAt;

    @Enumerated(EnumType.STRING)
    private EnrollmentType enrollmentType;

    private OffsetDateTime enrollmentOpensAt;

    private OffsetDateTime enrollmentClosesAt;

    private Integer structureVersion;

    private Integer sectionCount;

    private Integer lessonCount;

    private Integer publishedLessonCount;

    private OffsetDateTime publishedAt;

    @CreationTimestamp
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    private OffsetDateTime updatedAt;
}
