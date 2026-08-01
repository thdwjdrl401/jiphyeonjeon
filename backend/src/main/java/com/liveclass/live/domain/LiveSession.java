package com.liveclass.live.domain;

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
@Table(schema = "core", name = "live_session")
@Getter
@Setter
@NoArgsConstructor
public class LiveSession {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    private UUID lessonId;

    private UUID curriculumId;

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

    /**
     * 판서를 수강생 화면에 표시 중인가(ADR-0056).
     *
     * <p>판서 <b>내용</b>은 {@code live_annotation_op}에 있다. 이건 "그것을 지금 보여주는가"라서
     * 문서가 아니라 세션에 둔다.
     *
     * <p>이 값이 없으면 강사가 새로고침할 때마다 판서가 꺼진 채로 시작하는데 Egress는 자기 문서를
     * 계속 들고 있어 <b>수강생에게만 판서가 남는다</b> — 강사 화면에서는 정상으로 보이므로 알아챌
     * 수 없다.
     */
    private boolean annotationVisible;

    private boolean chatEnabled;

    private boolean aiQnaEnabled;

    @Version
    private Long version;

    @CreationTimestamp
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    private OffsetDateTime updatedAt;
}
