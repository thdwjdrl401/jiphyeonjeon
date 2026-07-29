package com.liveclass.video.service;

import com.liveclass.live.api.LiveSessionEndedEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * live 세션 종료 이벤트 → 녹화 중지. 커밋 후에만 반응한다.
 * 얇은 글루다 — 실제 로직·트랜잭션은 {@link RecordingService}(별도 빈)가 가져 프록시 자기호출을 피한다.
 *
 * <p><b>시작은 더 이상 이벤트로 받지 않는다</b>(ADR-0002 §1·§4). 학생 재생이 HLS 하나로 확정된 뒤로는
 * Egress가 준비돼야만 LIVE가 될 수 있어, 시작 오케스트레이터가
 * {@link com.liveclass.live.api.LiveRecordingControl}로 <b>동기</b> 호출하고 Gate B~C를 기다린다.
 * 여기서 {@code LiveSessionStartedEvent}를 다시 구독하면 같은 Egress를 두 번 시작하게 된다.
 */
@Component
public class RecordingEventListener {

    private static final Logger log = LoggerFactory.getLogger(RecordingEventListener.class);

    private final RecordingService recordingService;

    public RecordingEventListener(RecordingService recordingService) {
        this.recordingService = recordingService;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onSessionEnded(LiveSessionEndedEvent event) {
        try {
            recordingService.stopRecording(event.sessionId());
        } catch (RuntimeException e) {
            log.warn("녹화 중지 처리 실패(무시) session={}: {}", event.sessionId(), e.getMessage());
        }
    }
}
