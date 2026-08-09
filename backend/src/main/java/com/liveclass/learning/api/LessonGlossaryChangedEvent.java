package com.liveclass.learning.api;

import java.util.UUID;

/**
 * 강의 용어집이 바뀌었다. 진행 중인 라이브 화면이 다시 읽어야 한다는 신호다.
 *
 * <p><b>용어 원문을 싣지 않는다.</b> 용어집은 두 겹(AI가 뽑은 {@code ai.material_key_term} +
 * 강사 수정본)을 읽을 때 합쳐서 만들어지는데, 그 합치는 규칙을 이벤트 payload로 복제하면
 * 조회 경로와 갈라진다. 게다가 payload로 실어 브로드캐스트하면 조회에 걸린 인가
 * ({@code ensureCanViewInsights})를 우회하게 된다 — 신호만 보내고 각자 제 권한으로 다시 읽는다.
 *
 * @param lessonId 용어집이 바뀐 강의
 * @param reason   무엇이 바꿨는지. 로그로만 쓴다(원인 추적용).
 */
public record LessonGlossaryChangedEvent(UUID lessonId, Reason reason) {

    public enum Reason {
        /** AI가 자료에서 핵심 용어를 뽑아 냈다(임베딩 콜백). */
        MATERIAL_KEY_TERMS,
        /** 강사가 용어를 고치거나 더했다. */
        INSTRUCTOR_EDIT,
    }
}
