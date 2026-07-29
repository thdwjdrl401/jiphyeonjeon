package com.liveclass.live.domain;

import jakarta.persistence.Column;
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

/**
 * 라이브 시작 시도 1건(ADR-0002 §3). {@code /start}가 202를 돌려준 뒤에도 "이 시작이 어디까지 갔는지"를
 * DB가 소유해야 FE가 폴링으로 STARTING→LIVE/실패를 관찰할 수 있다.
 */
@Entity
@Table(schema = "core", name = "live_start_attempt")
@Getter
@Setter
@NoArgsConstructor
public class LiveStartAttempt {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    private UUID liveSessionId;

    /** FE에 돌려주는 오퍼레이션 ID. 상태 폴링의 키. */
    private UUID operationId;

    @Column(length = 128)
    private String correlationId;

    @Enumerated(EnumType.STRING)
    private LiveStartAttemptStatus status;

    @Enumerated(EnumType.STRING)
    private LiveStartStep step;

    /** 커밋 후 즉시 실행과 재조정기가 이 attempt를 실제로 집은 횟수. */
    private int attemptCount;

    /** 재조정기가 이 시도를 다시 볼 수 있는 가장 이른 시각. */
    private OffsetDateTime nextAttemptAt;

    /** 다중 Spring 인스턴스에서 한 실행기만 외부 작업을 진행하게 하는 짧은 DB lease. */
    @Column(length = 128)
    private String leaseOwner;

    private OffsetDateTime leaseUntil;

    @Column(length = 64)
    private String failureCode;

    @Column(length = 500)
    private String failureMessage;

    private OffsetDateTime completedAt;

    @CreationTimestamp
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    private OffsetDateTime updatedAt;
}
