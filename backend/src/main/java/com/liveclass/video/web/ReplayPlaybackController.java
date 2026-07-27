package com.liveclass.video.web;

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
 * 다시보기 재생·게시(ADR-0039). 재생은 소유 강사(검수)·활성 수강생(게시본)이 쓰고, 게시 전환은 소유 강사만.
 * 권한 판정은 {@link com.liveclass.video.api.LessonPlaybackAccess}(curriculum 구현)에 위임한다.
 */
@Tag(name = "다시보기", description = "VOD 재생(매니페스트 presigned 재작성 + 시간축 앵커)과 게시 전환.")
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
            description = "segment URI가 presigned GET으로 재작성된 recent 또는 dvr manifest를 반환한다.")
    @GetMapping("/api/lessons/{lessonId}/playback/manifest")
    public ResponseEntity<String> manifest(
                                           @Parameter(description = "레슨 UUID", example = SWAGGER_FIXTURE_LESSON_ID)
                                           @PathVariable UUID lessonId,
                                           @Parameter(description = "recent 또는 dvr", example = "dvr")
                                           @RequestParam String source,
                                           Authentication authentication) {
        String body = playbackService.manifest(
                UUID.fromString(authentication.getName()), lessonId, source);
        return ResponseEntity.ok()
                .contentType(HLS_MEDIA_TYPE)
                .cacheControl(org.springframework.http.CacheControl.noStore())
                .body(body);
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
