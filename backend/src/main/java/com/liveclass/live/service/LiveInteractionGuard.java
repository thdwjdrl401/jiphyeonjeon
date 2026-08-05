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

    /**
     * 이 세션이 <b>한 번이라도 시작한 적 있는가</b>.
     *
     * <p>{@code STARTING}은 아직 아니다 — 시작을 접수했을 뿐이고 {@code startedAt}은 {@code LIVE}
     * 전이에서 찍힌다. 그 전에는 자막도 판서도 채팅도 생길 수 없다.
     *
     * <p>이 판정을 여기 한 곳에 둔다. 쓰기(채팅·AI 전송)와 읽기(자막·노트·채팅 기록)가 같은 집합을
     * 쓰는데 각자 나열하면 한쪽만 고쳐질 자리가 된다({@link LiveAccessGuard}가 읽기 쪽에서 쓴다).
     */
    public boolean hasStarted(LiveSession session) {
        return session.getStatus() == LiveSessionStatus.LIVE
                || session.getStatus() == LiveSessionStatus.ENDING
                || session.getStatus() == LiveSessionStatus.ENDED;
    }

    public void requireInteractionAllowed(LiveSession session) {
        if (hasStarted(session)) {
            return;
        }
        throw new LiveSessionStateConflictException(
                "라이브가 시작된 뒤에만 채팅이나 AI 질문을 보낼 수 있습니다.");
    }
}
