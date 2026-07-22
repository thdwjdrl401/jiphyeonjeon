package com.liveclass.curriculum.service;

import java.util.UUID;

/**
 * 강사 운영 목록의 한 항목(MY-CURRICULUM-02, 서비스 계층 타입). 응답 DTO 변환은 컨트롤러가 한다
 * — 서비스가 web 계층을 참조하지 않도록(CatalogCard와 동일 방향).
 *
 * <p>계약 초안 대비 <b>의도적으로 빠진 필드</b>:
 * <ul>
 *   <li>{@code materialAttentionCount} — material_asset은 아직 배선되지 않은 골격이라
 *       (CP2, ADR-0024) 진짜 값을 만들 수 없다. 가짜 0을 내려 FE가 "정상"으로 오해하게 두느니
 *       필드를 통째로 뺀다.</li>
 *   <li>{@code allowedActions} — viewerContext/허용행동 모델이 레포 전체에 미구현이다.</li>
 * </ul>
 */
public record InstructorCurriculumCard(

        UUID curriculumId,
        String title,
        String summary,
        String thumbnailUrl,
        String lifecycleStatus,
        int sectionCount,
        int lessonCount,
        int publishedLessonCount,
        /** 남은 예정 세션이 없으면 null. */
        InstructorNextLiveSession nextLiveSession
) {
}
