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
        String boundaryReason,
        /**
         * 발화가 실제로 시작·종료한 UTC 벽시계(segment.final 전용, nullable, ADR-0107).
         *
         * <p>{@code start/endStreamElapsedMs}는 <b>받은 오디오의 누적 길이</b>라 무음이 빠진다 — 그래서
         * 세션 시계로 옮길 수 없다(ADR-0106). 이 두 값은 무음을 포함한 진짜 시각이라 {@code clockOriginAt}만
         * 빼면 세션-ms가 된다. agent가 안 실어 주면 null이고, 그때는 근사 축으로 물러난다.
         */
        OffsetDateTime startedAt,
        OffsetDateTime endedAt
) {

    public static final String TYPE_DELTA = "caption.delta";
    public static final String TYPE_COMPLETED = "caption.stream.completed";
    public static final String TYPE_STARTED = "caption.stream.started";
    public static final String TYPE_SEGMENT_FINAL = "caption.segment.final";

    /**
     * FE에 실시간 WS 중계·리로드되는 표시 대상 type(ADR-0052 2차 슬라이스). `delta`(진행중 부분 렌더)와
     * `completed`(종료 마커)에 더해 `segment.final`(확정 발화)을 포함한다. `started`(시간 앵커)는 표시
     * 대상이 아니라 영속만 하고 WS/리로드로 내보내지 않는다.
     */
    public static final List<String> RELAYED_TYPES = List.of(TYPE_DELTA, TYPE_COMPLETED, TYPE_SEGMENT_FINAL);

    /**
     * RAG {@code contextTimeMs}의 좌표(raw 단일 {@code streamElapsedMs})를 갖는 type. `started`(앵커만)·
     * `segment.final`(start/end 쌍)은 단일 좌표가 없어 제외한다 — 최신행이 이들이면 좌표가 null이 되어
     * RAG가 깨지므로 이 집합으로 배제한다(ADR-0052).
     */
    public static final List<String> CONTEXT_TIME_TYPES = List.of(TYPE_DELTA, TYPE_COMPLETED);

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
