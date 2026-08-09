package com.liveclass.video.service;

import com.liveclass.learning.api.WatchProgressSettlement;
import com.liveclass.video.api.RecordingReadyEvent;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 녹화가 준비되면 라이브 시청분을 진도로 환산하도록 learning에 알린다(ADR-0117).
 *
 * <p><b>이 리스너가 video에 있는 이유</b>는 방향 때문이다. learning이 녹화 사건을 직접 들으면
 * {@code aiintegration → learning → video → aiintegration} 순환이 생긴다(Modulith가 잡는다).
 * 사건은 video의 것이므로 듣는 쪽도 video이고, 계산은 learning이 선언한 포트에 맡긴다.
 *
 * <p><b>커밋 뒤에 부른다.</b> 녹화 확정 트랜잭션에 이 일을 얹으면 webhook 처리가 그만큼 길어지고,
 * 환산이 실패했다고 녹화 확정을 되돌릴 이유도 없다 — 진도는 다음 환산에서 따라잡을 수 있는 값이다.
 */
@Component
public class RecordingProgressListener {

    private final WatchProgressSettlement settlement;

    public RecordingProgressListener(WatchProgressSettlement settlement) {
        this.settlement = settlement;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onRecordingReady(RecordingReadyEvent event) {
        settlement.settleFromRecording(event.lessonId(), event.durationMs());
    }
}
