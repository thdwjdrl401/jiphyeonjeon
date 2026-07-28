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
 * 하나의 start attempt가 만든 explicit named AgentDispatch(ADR-0002 §3·§5-1).
 *
 * <p>Phase 4a에서도 dispatch ID를 반드시 저장한다. 그래야 Spring 재시작·중복 trigger 때 기존 예약을
 * 재사용하고 시작 실패 때 정확한 dispatch를 정리할 수 있다. job/worker/participant/readiness 필드는
 * Phase 4b에서 채운다.
 */
@Entity
@Table(schema = "core", name = "live_agent_job")
@Getter
@Setter
@NoArgsConstructor
public class LiveAgentJob {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    private UUID liveStartAttemptId;

    private UUID liveSessionId;

    @Column(length = 128)
    private String dispatchId;

    @Column(length = 128)
    private String agentName;

    @Column(columnDefinition = "text")
    private String metadataJson;

    @Enumerated(EnumType.STRING)
    private LiveAgentJobStatus status;

    @Column(length = 128)
    private String jobId;

    @Column(length = 128)
    private String workerId;

    @Column(length = 128)
    private String participantIdentity;

    @Column(length = 128)
    private String sttSessionId;

    private OffsetDateTime readyAt;

    @Column(length = 64)
    private String failureCode;

    @CreationTimestamp
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    private OffsetDateTime updatedAt;
}
