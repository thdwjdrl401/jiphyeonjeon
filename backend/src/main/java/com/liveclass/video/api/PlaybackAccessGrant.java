package com.liveclass.video.api;

/**
 * {@link LessonPlaybackAccess#resolve} 결과. 소유 강사인지(owner)만 담는다 — 게시·자산 상태 게이트는
 * video 서비스가 이 값(owner 여부)에 따라 다르게 적용한다.
 *
 * @param owner 소유 강사면 true(검수 목적으로 미게시·비READY 제약이 완화된다), 활성 수강생이면 false
 */
public record PlaybackAccessGrant(boolean owner) {
}
