package com.liveclass.aiintegration.api;

/**
 * 흘러가는 RAG 프레임을 <b>옆에서</b> 지켜보는 쪽(기록 등). 릴레이는 이 인터페이스만 알고, 무엇을
 * 어디에 남기는지는 모른다 — 그래서 aiintegration이 live의 저장소를 알 필요가 없다(순환 금지).
 *
 * <p>구현은 <b>절대 예외로 중계를 막지 않는다</b>. 기록은 편의이고 답변은 기능이다.
 */
public interface RagAnswerObserver {

    /** 아무것도 남기지 않는 관찰자. 기록이 필요 없는 경로가 쓴다. */
    RagAnswerObserver NONE = new RagAnswerObserver() {

        @Override
        public void observe(RagSseEvent event) {
            // 남기지 않는다
        }

        @Override
        public void finish() {
            // 남길 것이 없다
        }
    };

    /** 프레임 하나가 브라우저로 나가기 직전에 불린다. */
    void observe(RagSseEvent event);

    /** 스트림이 끝났다(정상·비정상 모두). 정확히 한 번 불린다. */
    void finish();
}
