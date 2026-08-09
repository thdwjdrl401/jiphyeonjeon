package com.liveclass.live.service;

import com.liveclass.live.domain.LiveSession;
import com.liveclass.live.domain.LiveSessionStatus;
import org.springframework.stereotype.Component;

/**
 * 채팅·AI 질문의 상태 게이트.
 *
 * <p>라이브 송출 종료와 대화 종료는 같은 상태축이 아니다(ADR-0004). 시작된 세션은 {@code ENDED}
 * 뒤에도 복습 질문을 이어갈 수 있다.
 *
 * <p><b>다만 채팅과 AI 질문은 갈라진다.</b> 채팅은 저장될 때 {@code sessionMs}(= clockOriginAt부터의
 * 경과)를 함께 남기고, 다시보기는 그 좌표로 재생 위치까지의 채팅만 보여 준다. 녹화가 멈춘
 * {@code ENDED} 뒤에 쓴 글은 좌표가 영상 길이를 넘어서 <b>다시보기에서 영원히 보이지 않는다</b> —
 * 그 강의실 URL에 남아 있는 사람에게만 보이는 글이 된다. 갈 곳이 없는 글은 받지 않는다.
 *
 * <p>AI 질문은 시간축에 얹히지 않으므로(개인 패널, 이력은 브라우저 메모리) 그대로 열어 둔다.
 * ADR-0004가 든 근거 중 "저장된 자막 근거 복습 질문"과 "종료 직전 답변 수신"은 그대로 지켜진다.
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

    /** AI 질문. 시작한 뒤라면 종료 후에도 허용한다. */
    public void requireInteractionAllowed(LiveSession session) {
        if (hasStarted(session)) {
            return;
        }
        throw new LiveSessionStateConflictException(
                "라이브가 시작된 뒤에만 채팅이나 AI 질문을 보낼 수 있습니다.");
    }

    /**
     * 채팅 전송. {@code ENDED}에서는 막는다 — 위 클래스 주석의 이유로 갈 곳이 없는 글이 된다.
     *
     * <p>{@code ENDING}은 허용한다. 녹화가 아직 돌고 있어 {@code sessionMs}가 영상 안에 들어간다.
     */
    public void requireChatAllowed(LiveSession session) {
        requireInteractionAllowed(session);
        if (session.getStatus() == LiveSessionStatus.ENDED) {
            throw new LiveSessionStateConflictException(
                    "종료된 강의에는 채팅을 보낼 수 없습니다. 질문은 AI에게 이어서 물어볼 수 있습니다.");
        }
    }
}
