package com.liveclass.learning.api;

import java.util.UUID;

/**
 * 이 사용자가 이 레슨을 학습(진도·북마크)할 수 있는지 판정하는 SPI 포트.
 *
 * <p>learning은 하위 모듈이라(curriculum이 learning의 progress를 읽는다) curriculum을 직접
 * 참조하면 순환이 된다. 그래서 "학습해도 되는가"의 판정을 learning이 인터페이스로 선언하고,
 * 레슨→커리큘럼→수강 관계를 아는 curriculum이 구현한다. 의존 방향은 curriculum → learning 으로
 * progress 조회와 같다(auth 계정 탈퇴 가드와 같은 패턴, ADR-0031·0032).
 *
 * <p>수강자가 아니면 {@link LessonNotLearnableException}을 던진다.
 */
public interface LessonLearningAccess {

    /** 학습 가능한 레슨·수강 관계인지 확인한다. 아니면 {@link LessonNotLearnableException}. */
    void ensureCanLearn(UUID userId, UUID lessonId);

    /**
     * 이 레슨의 <b>집계</b>를 볼 수 있는지 확인한다 — 수강생에 더해 <b>소유 강사도</b> 통과한다.
     *
     * <p>{@link #ensureCanLearn}과 나눈 이유: 학습(진도·북마크·시청 기록)은 수강생의 행위라 강사가
     * 하면 안 되지만, 재시청 그래프는 강사가 보라고 만든 것이다. 같은 게이트를 쓰면 정작 볼 사람이 막힌다.
     */
    void ensureCanViewInsights(UUID userId, UUID lessonId);
}
