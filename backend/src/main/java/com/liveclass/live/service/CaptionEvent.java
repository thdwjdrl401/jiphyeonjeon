package com.liveclass.live.service;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * 파싱·검증을 마친 자막 스트림 이벤트(CONTRACT §3-4). 와이어 정본은
 * {@code ai/realtime-agent/contracts/schemas/caption-stream-entry.schema.json}이며 Redis 엔트리의 모든
 * 필드는 문자열이다. 이 레코드는 그걸 타입으로 옮긴 결과다 — {@link CaptionEventParser}가 만든다.
 *
 * <p>네 가지 type이 한 레코드를 공유하며 해당 없는 필드는 null이다(delta/completed가 이미 그렇게 공존).
 * <ul>
 *   <li>{@code caption.delta} — {@code sequence}·{@code streamElapsedMs}·{@code text}.</li>
 *   <li>{@code caption.stream.completed} — {@code lastSequence}·{@code streamElapsedMs}·{@code reason}.</li>
 *   <li>{@code caption.stream.started}(ADR-0052) — {@code audioStartedAt}(첫 오디오 프레임=streamElapsedMs 0의
 *       절대 UTC 앵커). {@code streamElapsedMs}는 없어 null.</li>
 *   <li>{@code caption.segment.final}(ADR-0052) — client VAD가 확정한 한 발화. {@code segmentIndex}·
 *       {@code lastSequence}·{@code text}·{@code startStreamElapsedMs}·{@code endStreamElapsedMs}·
 *       {@code boundaryReason}. 단일 {@code streamElapsedMs}는 없어 null.</li>
 * </ul>
 *
 * <p>{@code streamElapsedMs}·{@code startStreamElapsedMs}·{@code endStreamElapsedMs}는 raw attempt-local
 * ms(agent 첫 프레임=0)이며 세션 상대 ms가 아니다 — 변환 없이 그대로 영속한다(CONTRACT §3-4 강제).
 */
public record CaptionEvent(
        String eventId,
        String type,
        UUID sessionId,
        UUID lessonId,
        String sttSessionId,
        Long sequence,
        Long lastSequence,
        Long streamElapsedMs,
        String text,
        String reason,
        OffsetDateTime occurredAt,
        OffsetDateTime audioStartedAt,
        Long segmentIndex,
        Long startStreamElapsedMs,
        Long endStreamElapsedMs,
        String boundaryReason
) {

    public static final String TYPE_DELTA = "caption.delta";
    public static final String TYPE_COMPLETED = "caption.stream.completed";
    public static final String TYPE_STARTED = "caption.stream.started";
    public static final String TYPE_SEGMENT_FINAL = "caption.segment.final";

    /**
     * FE에 실시간 중계·리로드되고 RAG {@code contextTimeMs}의 좌표(raw {@code streamElapsedMs})를 갖는
     * 표시 대상 type. started·segment.final은 여기 포함되지 않아 기존 WS/REST/RAG 경로가 그대로
     * 보존된다(ADR-0052 1차 슬라이스: 신규 type은 영속만, FE 전달은 후속). 두 신규 type의 표시·앵커
     * 활용은 후속 슬라이스에서 이 집합을 넓히며 도입한다.
     */
    public static final List<String> RELAYED_TYPES = List.of(TYPE_DELTA, TYPE_COMPLETED);

    public boolean isDelta() {
        return TYPE_DELTA.equals(type);
    }

    public boolean isCompleted() {
        return TYPE_COMPLETED.equals(type);
    }

    public boolean isStarted() {
        return TYPE_STARTED.equals(type);
    }

    public boolean isSegmentFinal() {
        return TYPE_SEGMENT_FINAL.equals(type);
    }
}
