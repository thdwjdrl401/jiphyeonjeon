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
 * 발화 예정 한 건(ADR-0073 §6). <b>언제 알릴지만 담고 누구에게는 담지 않는다</b> — 명단은 발화
 * 시점의 수강 상태가 정한다.
 */
@Entity
@Table(schema = "core", name = "notification_schedule")
@Getter
@Setter
@NoArgsConstructor
public class NotificationSchedule {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    private UUID liveSessionId;

    private Integer leadMinutes;

    /** 라이브 시작 시각. 발화가 밀렸을 때 "이미 시작한 라이브"를 걸러 내는 데 쓴다. */
    private OffsetDateTime startsAt;

    private OffsetDateTime fireAt;

    /** 채워지면 끝난 것이다. 폴링이 겹쳐 돌아도 이 행은 다시 뽑히지 않는다. */
    private OffsetDateTime firedAt;

    @CreationTimestamp
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    private OffsetDateTime updatedAt;
}
