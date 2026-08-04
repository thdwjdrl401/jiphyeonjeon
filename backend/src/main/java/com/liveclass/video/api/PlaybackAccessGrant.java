package com.liveclass.video.api;

import java.util.UUID;

/**
 * {@link LessonPlaybackAccess#resolve} 결과. 접근 주체와 레슨에서 확정한 커리큘럼 범위를 함께 담는다.
 *
 * @param owner 소유 강사면 true, 활성 수강생이면 false
 * @param curriculumId 서버가 레슨→섹션으로 확정한 커리큘럼. RAG 자료 검색 범위처럼 재생 권한과 같은
 *                     신뢰 경계에서 필요한 후속 처리가 사용한다.
 */
public record PlaybackAccessGrant(boolean owner, UUID curriculumId) {
}
