package com.liveclass.live.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 라이브 자막 소비 적재(ADR-0043, CONTRACT §3-4). realtime-agent가 Redis Stream에 XADD한
 * caption.delta·caption.stream.completed를 그대로 append-only 저장한다. {@code eventId}가 유일한
 * 멱등키다 — retry 시 {@code sttSessionId}가 바뀌며 {@code sequence}가 1부터 재시작하므로 sequence로는
 * 멱등을 잡지 않는다. {@code streamElapsedMs}는 raw attempt-local ms이며 세션 상대 ms로 변환하지 않는다.
 *
 * <p>{@code ChatMessage}와 동형(@Table(schema="core"), IDENTITY PK).
 */
@Entity
@Table(schema = "core", name = "live_caption")
@Getter
@Setter
@NoArgsConstructor
public class LiveCaption {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** AI 스트림 이벤트 ID(safeIdentifier). 유일한 멱등키 — UNIQUE. */
    private String eventId;

    /** caption.delta·caption.stream.completed·caption.stream.started·caption.segment.final. */
    private String eventType;

    private UUID sessionId;

    private UUID lessonId;

    /** STT job attempt 식별자. sequence 접기 범위 = (sessionId, sttSessionId). */
    private String sttSessionId;

    /** delta의 attempt-local 순번. 그 외 type에는 없어 null. */
    private Long sequence;

    /** completed·segment.final이 보고한 마지막 sequence. delta·started에는 없어 null. */
    private Long lastSequence;

    /** raw attempt-local ms(agent 첫 프레임=0). 세션 상대 ms 아님. started·segment.final엔 없어 null. */
    private Long streamElapsedMs;

    /** delta·segment.final 본문. started·completed에는 없어 null. */
    private String text;

    /** completed 종료 사유(ROOM_DELETED). 그 외 type엔 없어 null. */
    private String reason;

    /** agent가 이벤트를 만든 시각(스트림 occurredAt). */
    private OffsetDateTime occurredAt;

    /** started의 절대 시간 앵커(streamElapsedMs=0의 UTC, ADR-0052). 그 외 type엔 null. */
    private OffsetDateTime audioStartedAt;

    /** segment.final의 attempt 내 0-based 세그먼트 순번(ADR-0052). 그 외 type엔 null. */
    private Long segmentIndex;

    /** segment.final 세그먼트 시작 raw attempt-local ms(ADR-0052). 그 외 type엔 null. */
    private Long startStreamElapsedMs;

    /** segment.final 세그먼트 끝 raw attempt-local ms(ADR-0052). 그 외 type엔 null. */
    private Long endStreamElapsedMs;

    /** segment.final 경계 사유(SILENCE·MAX_DURATION·STREAM_END, ADR-0052). 그 외 type엔 null. */
    private String boundaryReason;

    @CreationTimestamp
    private OffsetDateTime receivedAt;
}
