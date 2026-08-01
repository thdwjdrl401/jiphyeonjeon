package com.liveclass.aiintegration.api;

import java.util.UUID;

/**
 * ai-api RAG 스트림 1건의 입력(ADR-0047, ai/ai-api/CONTRACT.md §2). 호출자(live 모듈)가 인가·정책을
 * 끝낸 뒤 만든다 — ai-api는 서명만 확인하고 이 body를 신뢰한다(ADR-0023 §9.1).
 *
 * <p>{@code issuedAtMs}는 여기 없다. 신선도(수신 시각과 60초 이상 차이나면 401)를 지키려면 <b>전송
 * 직전</b>에 찍어야 하므로 어댑터가 채운다.
 *
 * @param requestId    1~128자. 재사용하면 ai-api가 409 — 서버가 요청마다 새로 만든다.
 * @param lessonId     세션에서 서버가 조회한 값(클라 입력 신뢰 금지). wire에는 소문자 canonical UUID.
 * @param curriculumId 세션에서 서버가 조회한 값. ai-api가 <b>자료 검색 범위</b>로 쓴다 — PPTX 검색이
 *                     레슨이 아니라 커리큘럼 단위이고(ADR-0042), 근거의 커리큘럼이 다르면 버린다.
 *                     빠지면 ai-api가 400으로 거부한다(필수 필드).
 * @param sessionId    라이브 세션. wire에는 소문자 canonical UUID.
 * @param question     1~4,000자. <b>임의 trim 금지</b> — 사용자가 보낸 그대로 전달한다.
 * @param contextTimeMs 0 이상. 최신 STT attempt-local {@code streamElapsedMs} 좌표(세션 ms 아님).
 */
public record RagAnswerCommand(
        String requestId,
        UUID lessonId,
        UUID curriculumId,
        UUID sessionId,
        String question,
        long contextTimeMs
) {
}
