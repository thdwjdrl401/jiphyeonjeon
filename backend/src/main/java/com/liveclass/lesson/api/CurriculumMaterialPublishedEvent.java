package com.liveclass.lesson.api;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 강사가 자료를 붙였다. 그 커리큘럼을 <b>수강 중인 학생 전원</b>이 알아야 하는 사건이다.
 *
 * <p>수강 사건과 달리 <b>받는 사람이 정해져 있지 않다</b> — 명단은 발화 시점의 수강 상태가 정한다.
 * 그래서 이 사건에는 수신자가 없고, 커리큘럼만 있다(ADR-0073 §5).
 *
 * <p>임베딩 스위치와 무관하게 난다. 자료가 붙은 것은 학생에게 알릴 일이고, 그 자료를 AI가 읽는지는
 * 별개다.
 *
 * @param lessonId 레슨 자료면 그 레슨, 커리큘럼 전체 자료면 {@code null}. 화면이 어디로 보낼지
 *                 가르는 값이다.
 * @param fileName 문구에 들어갈 자료 이름. 나중에 파일명이 바뀌어도 알림은 그때 이름으로 남는다.
 */
public record CurriculumMaterialPublishedEvent(
        UUID curriculumId,
        String curriculumTitle,
        UUID lessonId,
        UUID materialId,
        String fileName,
        OffsetDateTime occurredAt
) {
}
