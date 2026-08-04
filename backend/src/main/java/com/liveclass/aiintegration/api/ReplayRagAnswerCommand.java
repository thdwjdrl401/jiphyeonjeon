package com.liveclass.aiintegration.api;

import java.util.List;
import java.util.UUID;

/**
 * ai-api Replay v2 요청. 업로드 녹화강의에서는 {@code sessionId} 슬롯에 서버가 조회한
 * {@code recordedVideoId}를 넣는다(ADR-0015). ai-api는 이 값을 라이브 DB 조회에 사용하지 않고 전달된
 * caption source의 범위 ID로만 사용한다.
 */
public record ReplayRagAnswerCommand(
        String requestId,
        UUID lessonId,
        UUID curriculumId,
        UUID sessionId,
        String question,
        long questionSessionMs,
        List<Caption> captions
) {

    public record Caption(
            String sttSessionId,
            int segmentIndex,
            long startSessionMs,
            long endSessionMs,
            String text
    ) {
    }
}
