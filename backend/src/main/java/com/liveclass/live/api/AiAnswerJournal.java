package com.liveclass.live.api;

import com.liveclass.aiintegration.api.RagAnswerObserver;

import java.util.UUID;

/**
 * 흘러가는 AI 답변을 받아 적는 포트(ADR-0047 확장). 라이브·다시보기 질문이 <b>같은 표</b>에 쌓여
 * 사용자가 한 세션에서 물어본 것을 한 줄기로 본다 — 다시보기에서 물어본 답이 새로고침에 사라지면
 * 라이브와 규칙이 달라진다.
 *
 * <p>기록은 <b>편의</b>다. 구현은 어떤 실패도 밖으로 던지지 않는다(중계가 답변이고 기록은 곁다리).
 */
public interface AiAnswerJournal {

    /**
     * 스트림 하나의 기록을 시작한다. 호출자는 반환된 관찰자를 릴레이에 넘기기만 하면 된다.
     *
     * @param requestId 이 스트림의 식별자. 같은 값으로 두 번 저장하지 않는다(멱등).
     * @param sessionId 질문이 속한 라이브 세션(다시보기는 그 재생본을 만든 세션)
     * @param userId    질문한 사람. 기록은 개인 범위로만 조회된다.
     */
    RagAnswerObserver start(String requestId, UUID sessionId, UUID lessonId, UUID userId, String question);
}
