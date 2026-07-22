package com.liveclass.enrollment.domain;

import com.liveclass.enrollment.api.EnrollmentStatus;
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
@Table(schema = "core", name = "enrollment")
@Getter
@Setter
@NoArgsConstructor
public class Enrollment {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    private UUID curriculumId;

    private UUID userId;

    @Enumerated(EnumType.STRING)
    private EnrollmentStatus status;

    private OffsetDateTime requestedAt;

    private OffsetDateTime decidedAt;

    private OffsetDateTime enrolledAt;

    // 낙관적 잠금: 동시 상태전이(예: 강사 approve vs 학생 cancel)의 lost-update를 막는다.
    // 지는 트랜잭션은 ObjectOptimisticLockingFailureException → 409(CONCURRENT_MODIFICATION).
    @Version
    private Long version;

    @CreationTimestamp
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    private OffsetDateTime updatedAt;
}
