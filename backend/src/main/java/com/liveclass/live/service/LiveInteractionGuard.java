package com.liveclass.live.service;

import com.liveclass.live.domain.LiveSession;
import com.liveclass.live.domain.LiveSessionStatus;
import org.springframework.stereotype.Component;

/** 채팅·AI 질문의 공통 상태 게이트. HLS 지연 구간인 ENDING까지 허용하고 ENDED부터 닫는다. */
@Component
public class LiveInteractionGuard {

    public void requireOpen(LiveSession session) {
        if (session.getStatus() == LiveSessionStatus.LIVE
                || session.getStatus() == LiveSessionStatus.ENDING) {
            return;
        }
        if (session.getStatus() == LiveSessionStatus.ENDED) {
            throw new LiveSessionInteractionClosedException(
                    "종료된 라이브에서는 채팅이나 AI 질문을 보낼 수 없습니다.");
        }
        throw new LiveSessionStateConflictException("라이브 중에만 채팅이나 AI 질문을 보낼 수 있습니다.");
    }
}
