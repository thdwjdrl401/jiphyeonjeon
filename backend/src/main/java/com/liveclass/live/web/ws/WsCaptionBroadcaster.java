package com.liveclass.live.web.ws;

import com.liveclass.live.service.CaptionAnchorLookup;
import com.liveclass.live.service.CaptionEvent;
import com.liveclass.live.service.LiveCaptionStoredEvent;
import com.liveclass.live.service.SessionClockLookup;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 적재된 자막을 {@code /topic/live-sessions/{sessionId}/captions} 구독자에게 실시간 전달한다
 * (CONTRACT §3-4·§3-6, {@code WsChatBroadcaster}와 동형). 커밋 후에만 발행하므로 저장된 자막만
 * 흘러나간다 — 멱등 중복은 {@link LiveCaptionStoredEvent}가 발행되지 않아 자연히 제외된다.
 *
 * <p>payload는 camelCase이고 {@code streamElapsedMs}는 raw 값 그대로다(변환 금지, CONTRACT §3-4).
 * 여기에 세션 축 시각을 <b>두 벌</b> 실어 학생이 HLS 위치에 자막을 맞출 수 있게 한다.
 *
 * <ul>
 *   <li>{@code sessionMs} — 근사({@code occurredAt−clockOriginAt}, ADR-0045). 도착 시각 기준이라 발화보다
 *       STT 지연만큼 늦다. clockOriginAt이 없으면 null.</li>
 *   <li>{@code anchoredSessionMs} — 정확({@code 앵커 + streamElapsedMs}, {@link CaptionAnchorLookup}).
 *       앵커가 없으면 null이고, 그때만 소비자가 근사로 물러난다.</li>
 * </ul>
 *
 * <p>둘을 <b>같이</b> 보내는 이유는 소비자가 어느 쪽인지 알아야 하기 때문이다 — 근사값에는 STT 지연
 * 보정이 필요하고 앵커값에는 필요 없다. 한 필드에 덮어쓰면 그 구분이 사라진다.
 */
@Component
public class WsCaptionBroadcaster {

    private final SimpMessagingTemplate messagingTemplate;
    private final SessionClockLookup sessionClockLookup;
    private final CaptionAnchorLookup captionAnchorLookup;

    public WsCaptionBroadcaster(SimpMessagingTemplate messagingTemplate,
                                SessionClockLookup sessionClockLookup,
                                CaptionAnchorLookup captionAnchorLookup) {
        this.messagingTemplate = messagingTemplate;
        this.sessionClockLookup = sessionClockLookup;
        this.captionAnchorLookup = captionAnchorLookup;
    }

    private Long anchored(LiveCaptionStoredEvent event, Long streamElapsedMs) {
        return captionAnchorLookup.anchoredSessionMs(event.sessionId(), event.sttSessionId(), streamElapsedMs);
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onStored(LiveCaptionStoredEvent event) {
        Long sessionMs = sessionClockLookup.approxSessionMs(event.sessionId(), event.occurredAt());
        Object payload = switch (event.eventType()) {
            case CaptionEvent.TYPE_COMPLETED ->
                    CaptionCompletedPayload.from(event, sessionMs, anchored(event, event.streamElapsedMs()));
            // 세그먼트는 **시작** 좌표를 앵커에 태운다 — 소비자가 필요한 것은 발화가 시작된 시각이다
            // (노출 경계·seek 목표가 모두 시작 기준이다). 끝은 시작 + 구간 길이로 얻는다.
            case CaptionEvent.TYPE_SEGMENT_FINAL ->
                    CaptionSegmentPayload.from(event, sessionMs, anchored(event, event.startStreamElapsedMs()));
            default ->
                    CaptionDeltaPayload.from(event, sessionMs, anchored(event, event.streamElapsedMs()));
        };
        WsEnvelope envelope = WsEnvelope.of(event.eventType(), event.sessionId(), event.occurredAt(), payload);
        messagingTemplate.convertAndSend(
                "/topic/live-sessions/" + event.sessionId() + "/captions", envelope);
    }
}
