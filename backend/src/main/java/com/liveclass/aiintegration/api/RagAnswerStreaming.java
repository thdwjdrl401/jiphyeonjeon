package com.liveclass.aiintegration.api;

import java.time.Duration;

/**
 * Spring→ai-api RAG SSE 포트(CONTRACT §3-9, ADR-0023 §9.1). 인증·인가·정책은 호출자(live 모듈)가
 * 끝낸 뒤 부른다 — 이 포트는 HMAC 서명과 전송만 책임진다.
 */
public interface RagAnswerStreaming {

    /**
     * 업스트림이 한 스트림을 유지하는 상한. 브라우저 쪽 emitter 타임아웃을 이보다 짧게 잡으면
     * 정상 응답이 도중에 끊기므로 호출자가 이 값을 그대로 쓴다.
     */
    Duration streamTimeout();

    /**
     * ai-api에 스트림을 연다. <b>응답 헤더를 받을 때까지 블로킹</b>하므로, 여기서 던지는 실패는
     * 아직 브라우저에 SSE 헤더를 내보내기 전이라 평범한 JSON 오류로 매핑할 수 있다.
     *
     * @throws RagAnswerUpstreamException 연결 실패 또는 200이 아닌 응답
     */
    RagAnswerStreamHandle open(RagAnswerCommand command);
}
