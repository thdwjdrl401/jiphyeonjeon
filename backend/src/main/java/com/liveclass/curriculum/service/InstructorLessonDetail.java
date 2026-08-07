package com.liveclass.curriculum.service;

import com.liveclass.lesson.api.LessonView;
import com.liveclass.lesson.api.MaterialView;
import com.liveclass.live.api.LiveSessionView;

import java.util.List;
import java.util.UUID;

/**
 * 강사 레슨 단건 상세 = 레슨 + 연결된 활성 자료(ADR-0035) + 이 레슨의 라이브 세션(있으면)
 * + 소속 커리큘럼 id.
 *
 * <p>라이브 세션을 포함하는 이유: 강사 수정 폼과 사이드바가 예전엔 공개 카탈로그
 * ({@code GET /curriculums/{id}})에서 세션을 읽었는데, 그 경로는 PUBLISHED만 노출해 DRAFT
 * 커리큘럼·레슨에서는 방금 만든 세션이 안 보였다. 읽기를 쓰기와 같은 강사 권한 축에 둔다.
 * {@code liveSession}은 없으면 null(레슨당 최대 하나 — DDL UNIQUE).
 *
 * <p>{@code curriculumId}를 포함하는 이유: 이 상세를 호출하는 화면(다시보기 등)이 항상
 * curriculumId를 미리 알고 있는 것은 아니다 — 수강생용 {@code GET /lessons/{id}}는 이미
 * curriculumId를 주는데 강사용은 주지 않아, 그 화면들이 "강의 상세" 경로를 못 만들고 404로
 * 떨어졌다. 소유권 검증(requireOwnedSection)이 이미 아는 값이라 추가 조회 없이 채운다.
 */
public record InstructorLessonDetail(
        LessonView lesson, List<MaterialView> materials, LiveSessionView liveSession, UUID curriculumId) {
}
