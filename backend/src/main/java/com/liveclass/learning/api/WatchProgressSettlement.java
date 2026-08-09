package com.liveclass.learning.api;

import java.util.UUID;

/**
 * 쌓인 시청 칸을 진도로 환산한다(ADR-0117).
 *
 * <p>라이브 중에는 진도가 나가지 않는다. 진도율은 <b>본 칸 ÷ 전체 칸</b>인데 전체 칸 수는 강의 길이에서
 * 나오고, 그 길이는 녹화가 끝나야 생기기 때문이다(ADR-0063). 그래서 녹화가 준비되는 순간이 라이브
 * 시청분에 <b>분모가 처음 생기는 자리</b>다.
 *
 * <p><b>learning이 선언하고 video가 부른다.</b> 반대로 learning이 녹화 사건을 직접 듣게 하면
 * {@code aiintegration → learning → video → aiintegration} 순환이 생긴다(Modulith가 잡는다).
 * 레슨→섹션 관계를 curriculum에게 묻는 {@link LessonLearningAccess}와 같은 방향 규칙이다.
 */
public interface WatchProgressSettlement {

    /**
     * 그 강의의 시청 칸을 진도로 환산한다. 이미 쌓인 진도는 깎지 않는다(ADR-0116).
     *
     * @param durationMs 녹화 길이 = 분모의 근거. 모르면 아무것도 하지 않는다 — 잘못 계산하지 않는다.
     */
    void settleFromRecording(UUID lessonId, Long durationMs);
}
