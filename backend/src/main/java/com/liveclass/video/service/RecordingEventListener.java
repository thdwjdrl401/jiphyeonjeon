package com.liveclass.video.service;

import com.liveclass.live.api.LiveSessionEndedEvent;
import com.liveclass.live.api.LiveSessionStartedEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * live 세션 생명주기 이벤트 → 녹화 트리거. 커밋 후에만 반응해 롤백된 세션을 녹화하지 않는다.
 * 얇은 글루다 — 실제 로직·트랜잭션은 {@link RecordingService}(별도 빈)가 가져 프록시 자기호출을 피한다.
 * video 모듈에서 live.api에 의존하는 유일한 지점.
 */
@Component
public class RecordingEventListener {

    private static final Logger log = LoggerFactory.getLogger(RecordingEventListener.class);

    private final RecordingService recordingService;

    public RecordingEventListener(RecordingService recordingService) {
        this.recordingService = recordingService;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onSessionStarted(LiveSessionStartedEvent event) {
        if (!event.recordingEnabled()) {
            return;   // 녹화 비활성 세션은 자산을 만들지 않는다.
        }
        // best-effort: 녹화 시작 중 어떤 예외도 세션(이미 커밋됨) 밖으로 새지 않게 여기서 삼킨다.
        try {
            recordingService.startRecording(event.sessionId(), event.lessonId(), event.roomName());
        } catch (RuntimeException e) {
            log.warn("녹화 시작 처리 실패(무시) session={}: {}", event.sessionId(), e.getMessage());
        }
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
