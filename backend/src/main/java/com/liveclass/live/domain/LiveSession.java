package com.liveclass.live.domain;

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
@Table(schema = "core", name = "live_session")
@Getter
@Setter
@NoArgsConstructor
public class LiveSession {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    private UUID lessonId;

    private UUID instructorId;

    @Enumerated(EnumType.STRING)
    private LiveSessionStatus status;

    private OffsetDateTime scheduledAt;

    private Integer entryWindowMinutes;

    private Integer expectedDurationMinutes;

    private String roomSid;

    private OffsetDateTime startedAt;

    private OffsetDateTime clockOriginAt;

    private OffsetDateTime endedAt;

    private UUID startedBy;

    private boolean recordingEnabled;

    private boolean captionEnabled;

    private boolean chatEnabled;

    private boolean aiQnaEnabled;

    private Long version;

    @CreationTimestamp
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    private OffsetDateTime updatedAt;
}
