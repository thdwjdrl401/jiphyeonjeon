package com.liveclass.live.api;

import com.liveclass.aiintegration.api.ReplayRagAnswerCommand;

import java.util.List;
import java.util.UUID;

/**
 * 다시보기 질문 한 건에 필요한 live 쪽 문맥({@link ReplayAiContextSource}의 결과).
 *
 * @param curriculumId 세션이 들고 있는 커리큘럼. ai-api의 <b>자료 검색 범위</b>라 없으면 400이다.
 * @param captions     질문 시점 주변의 확정 자막(세션 상대 ms로 변환 완료). 없으면 빈 목록 —
 *                     자막이 없어도 자료만으로 답할 수 있으므로 실패가 아니다.
 */
public record ReplayAiContext(
        UUID curriculumId,
        List<ReplayRagAnswerCommand.Caption> captions
) {

    public ReplayAiContext {
        captions = captions == null ? List.of() : List.copyOf(captions);
    }
}
