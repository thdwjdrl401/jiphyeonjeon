package com.liveclass.live.service;

import com.liveclass.live.domain.LiveSession;
import com.liveclass.live.domain.LiveSessionStatus;
import org.springframework.stereotype.Component;

/**
 * 채팅·AI 질문의 공통 상태 게이트.
 *
 * <p>라이브 송출 종료와 대화 종료는 같은 상태축이 아니다. 시작된 세션은 {@code ENDED} 뒤에도
 * 복습 질문과 후속 토론을 이어갈 수 있으므로 {@code LIVE·ENDING·ENDED}에서 허용한다.
 */
@Component
public class LiveInteractionGuard {

    public void requireInteractionAllowed(LiveSession session) {
        if (session.getStatus() == LiveSessionStatus.LIVE
                || session.getStatus() == LiveSessionStatus.ENDING
                || session.getStatus() == LiveSessionStatus.ENDED) {
            return;
        }
        throw new LiveSessionStateConflictException(
                "라이브가 시작된 뒤에만 채팅이나 AI 질문을 보낼 수 있습니다.");
    }
}
