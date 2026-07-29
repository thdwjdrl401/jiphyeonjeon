package com.liveclass.aiintegration.api;

/**
 * ai-api가 보낸 SSE 프레임 하나(named event + 한 줄 JSON data). 브라우저로 <b>그대로</b> 중계하기 위한
 * 최소 표현이라 data를 파싱하지 않는다 — 변환 계층을 두면 정보 손실·유지비만 생긴다(ADR-0046).
 *
 * @param name event 이름. {@code answer.delta}·{@code answer.done}·{@code answer.insufficient}·{@code answer.error}.
 * @param data data 라인 원문(여러 줄이면 {@code \n}으로 이어붙인 값).
 */
public record RagSseEvent(String name, String data) {

    /** 한 스트림은 delta 0개 이상 뒤 terminal 정확히 하나로 끝난다(ai/ai-api/CONTRACT.md §3). */
    public boolean isTerminal() {
        return "answer.done".equals(name) || "answer.insufficient".equals(name) || "answer.error".equals(name);
    }
}
