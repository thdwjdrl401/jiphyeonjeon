package com.liveclass.video.api;

import java.util.UUID;

/**
 * 다시보기 재생 권한 판정 SPI. video 모듈이 선언하고, 레슨→섹션→커리큘럼→수강·소유 관계를 아는
 * curriculum이 구현한다(learning의 {@code LessonLearningAccess}와 같은 방향 — video가 curriculum을
 * 직접 참조하면 순환이라 판정만 인터페이스로 위임한다).
 *
 * <p>재생은 학습(진도)과 게이트가 다르다: 강사는 <b>검수 목적으로 자기 레슨을 항상</b> 볼 수 있어야 하고
 * (미수강이어도), 학생은 활성 수강생일 때만이다. 그래서 "학습 가능" 판정을 재사용하지 않고 별도로 둔다 —
 * 여기서는 소유 강사 여부(owner)와 신뢰 가능한 curriculumId를 돌려주고, 게시 상태(PUBLISHED)·자산 READY
 * 게이트는 video가 적용한다. curriculumId는 녹화강의 Replay RAG의 검색 범위를 조립할 때도 사용한다.
 */
public interface LessonPlaybackAccess {

    /**
     * 이 사용자가 이 레슨의 다시보기에 접근할 자격이 있는지 판정한다.
     *
     * @return 접근 주체와 서버가 조회한 curriculumId
     * @throws PlaybackAccessException 레슨이 없으면 {@code NOT_FOUND}, 소유 강사도 활성 수강생도 아니면 {@code ENROLLMENT_REQUIRED}
     */
    PlaybackAccessGrant resolve(UUID userId, UUID lessonId);
}
