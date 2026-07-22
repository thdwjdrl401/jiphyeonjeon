package com.liveclass.curriculum.web.dto;

import com.liveclass.curriculum.service.InstructorCurriculumCard;
import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 강사 운영 목록의 카드(MY-CURRICULUM-02). 단건 응답({@link CurriculumResponse})과 분리해 둔다
 * — 목록은 다음 일정 같은 화면 전용 정보를 얹고, 단건은 관리 상세(구조 버전·기간 등)를 유지한다.
 *
 * <p>계약 초안의 {@code materialAttentionCount}·{@code allowedActions}는 <b>이번 범위 밖</b>이라
 * 필드 자체를 넣지 않았다(각각 material_asset 미배선 / viewerContext 미구현). 가짜 기본값을
 * 내려보내 FE가 구현된 것으로 오해하지 않게 하려는 의도적 누락이다.
 */
@Schema(description = "강사 운영 커리큘럼 카드")
public record InstructorCurriculumListItem(

        String curriculumId,
        String title,
        String summary,
        @Schema(description = "표시용 썸네일 URL. 에셋 없음/미해결 시 null.")
        String thumbnailUrl,
        String lifecycleStatus,
        int sectionCount,
        int lessonCount,
        int publishedLessonCount,
        @Schema(description = "가장 가까운 예정 라이브 세션. 남은 일정이 없으면 null.")
        NextLiveSessionSummary nextLiveSession
) {

    public static InstructorCurriculumListItem from(InstructorCurriculumCard card) {
        return new InstructorCurriculumListItem(
                card.curriculumId().toString(),
                card.title(),
                card.summary(),
                card.thumbnailUrl(),
                card.lifecycleStatus(),
                card.sectionCount(),
                card.lessonCount(),
                card.publishedLessonCount(),
                NextLiveSessionSummary.from(card.nextLiveSession()));
    }
}
