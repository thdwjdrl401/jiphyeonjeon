package com.liveclass.live.repository;

import com.liveclass.live.domain.LiveCaption;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface LiveCaptionRepository extends JpaRepository<LiveCaption, Long> {

    /** 멱등 사전 확인(fast path): 이미 소비한 eventId면 저장을 건너뛴다. */
    boolean existsByEventId(String eventId);

    /** eventId로 적재된 자막 조회(테스트·진단용). */
    Optional<LiveCaption> findByEventId(String eventId);

    /** 특정 세션의 적재 자막 수(테스트·진단용). */
    long countBySessionId(UUID sessionId);

    /**
     * 세션의 적재 자막 중 <b>표시 대상 type만</b> 세션-ms 순으로(=occurredAt 오름차순, 동시각은 삽입순 id)
     * 반환한다. 리로드 응답용 — occurredAt이 근사 sessionMs의 유일한 입력이라 occurredAt 정렬이 곧
     * sessionMs 정렬이다. {@code eventTypes}로 started·segment.final(표시 대상 아님)을 배제한다
     * ({@link com.liveclass.live.service.CaptionEvent#RELAYED_TYPES}, ADR-0052).
     */
    List<LiveCaption> findBySessionIdAndEventTypeInOrderByOccurredAtAscIdAsc(
            UUID sessionId, Collection<String> eventTypes);

    /**
     * 세션의 <b>가장 최근</b> 표시 대상 자막 행(정렬은 리로드와 같은 축의 역순). RAG 질의의
     * {@code contextTimeMs}는 "최신 STT attempt-local {@code streamElapsedMs} 좌표"라서 이 행의 raw 값이
     * 곧 규격 값이다 — 세션-ms로 변환하지 않으므로 앵커 문제가 없다(ADR-0047). {@code eventTypes}로
     * streamElapsedMs가 없는 started·segment.final을 배제해 최신 좌표가 null이 되는 회귀를 막는다(ADR-0052).
     */
    Optional<LiveCaption> findFirstBySessionIdAndEventTypeInOrderByOccurredAtDescIdDesc(
            UUID sessionId, Collection<String> eventTypes);

    /**
     * 세션의 특정 type 행을 적재 순서대로 전부 가져온다. 다시보기 AI가 확정 발화
     * ({@code caption.segment.final})와 시간 앵커({@code caption.stream.started})를 읽을 때 쓴다.
     *
     * <p>세션 하나치를 통째로 읽는다 — 2시간 강의라도 확정 발화는 1~2천 행 수준이고
     * {@code ix_live_caption_session}이 그대로 듣는다. 질문 시점으로 SQL에서 좁히지 <b>않는</b> 이유는
     * 좁힐 좌표가 행 자체에 없기 때문이다: 세션 ms는 attempt 앵커를 적용해야 나오고, 그 앵커는
     * 다른 type의 행에 들어 있다.
     */
    List<LiveCaption> findBySessionIdAndEventTypeOrderByIdAsc(UUID sessionId, String eventType);
}
