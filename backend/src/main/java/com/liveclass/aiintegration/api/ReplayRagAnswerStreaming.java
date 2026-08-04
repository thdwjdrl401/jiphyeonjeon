package com.liveclass.aiintegration.api;

import java.time.Duration;

/** Spring이 과거 VOD 자막 문맥을 함께 보내는 ai-api Replay v2 SSE 포트. */
public interface ReplayRagAnswerStreaming {

    Duration streamTimeout();

    RagAnswerStreamHandle open(ReplayRagAnswerCommand command);
}
