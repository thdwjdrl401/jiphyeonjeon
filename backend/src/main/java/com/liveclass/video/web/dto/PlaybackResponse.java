package com.liveclass.video.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 다시보기 재생 응답 (ARCHITECTURE §9-8·§9-9, ADR-0039). HLS 매니페스트를 인라인으로 싣고, 시간축 앵커를
 * 오프셋 하나로 내려준다.
 *
 * <p>세그먼트 바이트는 이 응답에 없다 — 매니페스트 안의 세그먼트 URI가 이미 presigned GET URL로 재작성돼
 * 있어 클라이언트가 스토리지에서 직접 받는다(원칙 4). hls.js는 {@code manifest}를 {@code Blob}/data-URI로
 * 물려 재생한다.
 *
 * @param manifest       세그먼트 URI가 presigned URL로 재작성된 VOD HLS 매니페스트(application/vnd.apple.mpegurl 본문)
 * @param sessionOffsetMs 재생 위치(ms)를 세션 상대 ms로 옮기는 오프셋: {@code 세션ms = currentTime*1000 + sessionOffsetMs}.
 *                        매니페스트 첫 {@code #EXT-X-PROGRAM-DATE-TIME} − 세션 시작시각. PDT나 시작시각이 없으면 null(에러 아님).
 * @param durationMs     녹화 길이(ms). 아직 확정 전이면 null.
 */
@Schema(description = "다시보기 재생 정보. 매니페스트는 세그먼트가 presigned URL로 재작성돼 있고, sessionOffsetMs로 자막·채팅을 정렬한다.")
public record PlaybackResponse(
        String manifest,
        Long sessionOffsetMs,
        Long durationMs
) {
}
