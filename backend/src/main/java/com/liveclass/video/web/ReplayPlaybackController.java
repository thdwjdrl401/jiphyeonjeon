package com.liveclass.video.web;

import com.liveclass.video.PlaybackPaths;
import com.liveclass.video.service.ReplayPlaybackService;
import com.liveclass.video.service.ReplayPublicationService;
import com.liveclass.video.web.dto.PlaybackResponse;
import com.liveclass.video.web.dto.WithdrawReplayRequest;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * 라이브 되감기·종료 후 다시보기 재생과 게시 상태 관리(ADR-0039, choinhoo/0001).
 *
 * <p>재생은 metadata(source·시간축)와 manifest(presigned 재작성 본문) 두 단계다. 라이브 중에는 소유
 * 강사와 활성 수강생이 게시 상태와 무관하게 보고, 종료 후에는 소유 강사(검수)와 게시본을 보는 활성
 * 수강생만 본다. 게시·철회는 소유 강사 전용이다.
 * 권한 판정은 {@link com.liveclass.video.api.LessonPlaybackAccess}(curriculum 구현)에 위임한다.
 */
@Tag(name = "다시보기",
        description = "라이브 되감기·종료 후 VOD 재생(metadata + presigned 재작성 manifest)과 게시·철회.")
@RestController
public class ReplayPlaybackController {

    private static final MediaType HLS_MEDIA_TYPE = MediaType.valueOf("application/vnd.apple.mpegurl");
    private static final String SWAGGER_FIXTURE_LESSON_ID = "30000000-0000-4000-8000-000000000001";

    private final ReplayPlaybackService playbackService;
    private final ReplayPublicationService publicationService;

    public ReplayPlaybackController(ReplayPlaybackService playbackService,
                                    ReplayPublicationService publicationService) {
        this.playbackService = playbackService;
        this.publicationService = publicationService;
    }

    @Operation(summary = "다시보기 재생 정보",
            description = "라이브 recent/dvr 또는 종료 후 VOD source와 세션 상대 시간 범위를 반환한다.")
    @GetMapping("/api/lessons/{lessonId}/playback")
    public PlaybackResponse playback(
            @Parameter(description = "레슨 UUID", example = SWAGGER_FIXTURE_LESSON_ID)
            @PathVariable UUID lessonId,
            Authentication authentication) {
        return playbackService.playback(UUID.fromString(authentication.getName()), lessonId);
    }

    @Operation(summary = "HLS 재생목록",
            description = """
                    세그먼트 URI가 presigned GET으로 재작성된 manifest를 반환한다.
                    라이브 중에는 #EXT-X-SERVER-CONTROL:CAN-SKIP-UNTIL을 실어 델타 재생목록을 광고하고,
                    플레이어가 _HLS_skip=YES로 다시 물으면 경계보다 오래된 세그먼트를 #EXT-X-SKIP으로 생략한다.
                    종료 후 재생목록은 #EXT-X-ENDLIST가 있어 플레이어가 다시 받지 않으므로 전체를 그대로 준다.""")
    @GetMapping(PlaybackPaths.MANIFEST_TEMPLATE)
    public ResponseEntity<String> manifest(
            @Parameter(description = "레슨 UUID", example = SWAGGER_FIXTURE_LESSON_ID)
            @PathVariable UUID lessonId,
            // hls.js가 붙이는 델타 요청 지시자(RFC 8216bis §6.2.5.1). 이름이 규격이라 그대로 받는다.
            @Parameter(description = "델타 재생목록 요청. 플레이어가 자동으로 붙인다.", example = "YES")
            @RequestParam(name = "_HLS_skip", required = false) String hlsSkip,
            Authentication authentication) {
        String body = playbackService.manifest(
                UUID.fromString(authentication.getName()), lessonId, isDeltaRequest(hlsSkip));
        return ResponseEntity.ok()
                .contentType(HLS_MEDIA_TYPE)
                .cacheControl(org.springframework.http.CacheControl.noStore())
                .body(body);
    }

    /** {@code YES}와 {@code v2}(DATERANGE까지 생략) 모두 델타 요청이다. 우리는 둘을 같게 처리한다. */
    private boolean isDeltaRequest(String hlsSkip) {
        return hlsSkip != null && (hlsSkip.equalsIgnoreCase("YES") || hlsSkip.equalsIgnoreCase("v2"));
    }

    @Operation(summary = "다시보기 게시",
            description = "다시보기를 PUBLISHED로 전환한다(소유 강사만, 자산 READY 필요). 이미 게시됐어도 멱등.")
    @PostMapping("/api/instructor/lessons/{lessonId}/replay-review/publish")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void publish(
            @Parameter(description = "레슨 UUID", example = SWAGGER_FIXTURE_LESSON_ID)
            @PathVariable UUID lessonId,
            Authentication authentication) {
        publicationService.publish(UUID.fromString(authentication.getName()), lessonId);
    }

    @Operation(summary = "다시보기 게시 철회",
            description = "종료된 세션의 다시보기를 WITHDRAWN으로 전환한다. 라이브 중에는 409.")
    @PostMapping("/api/instructor/lessons/{lessonId}/replay-review/withdraw")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void withdraw(
                         @Parameter(description = "레슨 UUID", example = SWAGGER_FIXTURE_LESSON_ID)
                         @PathVariable UUID lessonId,
                         @Valid @RequestBody(required = false) WithdrawReplayRequest request,
                         Authentication authentication) {
        publicationService.withdraw(
                UUID.fromString(authentication.getName()),
                lessonId,
                request != null ? request.reason() : null);
    }
}
