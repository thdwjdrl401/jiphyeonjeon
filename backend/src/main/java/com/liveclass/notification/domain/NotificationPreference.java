package com.liveclass.notification.domain;

import jakarta.persistence.Entity;
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

/**
 * 곧 시작 알림 설정 한 건.
 *
 * <p>{@code lessonId}가 비어 있으면 커리큘럼 전체, 값이 있으면 그 강의만 덮어쓴다.
 *
 * <p>{@code enabled}를 따로 둔 이유는 <b>"행이 없다"와 "꺼 뒀다"를 구별</b>하기 위해서다.
 * 끄기를 {@code leadMinutes = null}로 표현하면 기본값이 바뀌는 날 꺼 둔 사람에게 알림이 되살아난다.
 */
@Entity
@Table(schema = "core", name = "notification_preference")
@Getter
@Setter
@NoArgsConstructor
public class NotificationPreference {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    private UUID userId;

    private UUID curriculumId;

    /** null이면 커리큘럼 전체 설정. */
    private UUID lessonId;

    private boolean enabled = true;

    private Integer leadMinutes;

    @CreationTimestamp
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    private OffsetDateTime updatedAt;
}
