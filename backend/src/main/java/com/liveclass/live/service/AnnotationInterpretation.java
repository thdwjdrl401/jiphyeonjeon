package com.liveclass.live.service;

import java.util.List;

/**
 * 판서 해석 결과(ADR-0054, CONTRACT §3-6e).
 *
 * <p><b>좌표가 없다.</b> 모델에게 위치를 묻지 않기 때문이다 — 실측에서 최대 96px 틀렸고, 같은
 * 좌표를 우리는 획의 점에서 오차 없이 얻는다. 배치는 클라이언트가 한다(mermaid는 dagre가, 수식은
 * 원본 획의 bbox가 정한다).
 *
 * @param kind       {@code "mermaid"} 또는 {@code "math"}
 * @param body       판서에 <b>그대로 넣을</b> 것. 다이어그램은 mermaid 정의, 수식은 유니코드 문자열이다
 *                   — Excalidraw에 수식 렌더러가 없어 LaTeX를 그대로 넣으면 `y = ax^2 + bx + c`가
 *                   글자 그대로 보인다
 * @param source     수식일 때의 LaTeX 원문. 지금은 넣지 않고, 다시보기 앵커·그래프·RAG에 쓰려고 남긴다.
 *                   다이어그램일 때는 빈 문자열
 * @param replace    지울 요소 id. 요청에 실린 선택 요소의 부분집합이다
 * @param confidence 모델이 스스로 매긴 값. <b>자동 적용의 근거로 쓰지 않는다</b> — 실측에서 틀린
 *                   라벨에 1.0이 붙었다. 강사에게 보여 주는 참고값일 뿐이다
 * @param unreadable 읽지 못했다. 이때 {@code body}는 쓰지 않는다
 */
public record AnnotationInterpretation(
        String kind,
        String body,
        String source,
        List<String> replace,
        double confidence,
        boolean unreadable
) {

    public static AnnotationInterpretation unreadable(String kind) {
        return new AnnotationInterpretation(kind, "", "", List.of(), 0.0, true);
    }
}
