package com.liveclass.video.api;

/**
 * 업로드 녹화강의 기능 스위치의 현재 상태. 강사 화면이 <b>폼을 열 때</b> 읽어, 다 채우고 제출한
 * 뒤에야 503으로 막히는 대신 미리 안내하고 제출을 잠근다.
 *
 * <p>이 응답은 안내용이고 <b>게이트가 아니다</b> — 실제 차단은 서버가 계속 한다
 * ({@code RECORDED_VIDEO_DISABLED}·{@code RECORDED_STT_REQUIRED}, 503).
 *
 * @param videoUploadEnabled MP4 업로드·HLS 변환 파이프라인이 열려 있는가
 * @param captionGenerationEnabled 업로드 영상의 배치 STT가 열려 있는가. 자막이 READY|EMPTY가
 *                                 되어야 재생 패키지가 게시되므로, 닫혀 있으면 업로드 자체를 막는다
 */
public record RecordedVideoCapabilities(boolean videoUploadEnabled, boolean captionGenerationEnabled) {
}
