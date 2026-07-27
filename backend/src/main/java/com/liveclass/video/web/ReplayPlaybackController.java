package com.liveclass.video.web;

import com.liveclass.video.service.ReplayPlaybackService;
import com.liveclass.video.web.dto.PlaybackResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
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

    private final ReplayPlaybackService playbackService;

    public ReplayPlaybackController(ReplayPlaybackService playbackService) {
        this.playbackService = playbackService;
    }

    @Operation(summary = "다시보기 재생 정보",
            description = "세그먼트가 presigned URL로 재작성된 HLS 매니페스트와 시간축 오프셋을 반환한다. "
                    + "소유 강사는 게시 전에도(검수), 학생은 활성 수강 + PUBLISHED일 때만.")
    @GetMapping("/api/lessons/{lessonId}/playback")
    public PlaybackResponse playback(@PathVariable UUID lessonId, Authentication authentication) {
        return playbackService.playback(UUID.fromString(authentication.getName()), lessonId);
    }

    @Operation(summary = "다시보기 게시",
            description = "다시보기를 PUBLISHED로 전환한다(소유 강사만, 자산 READY 필요). 이미 게시됐어도 멱등.")
    @PostMapping("/api/instructor/lessons/{lessonId}/replay-review/publish")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void publish(@PathVariable UUID lessonId, Authentication authentication) {
        playbackService.publish(UUID.fromString(authentication.getName()), lessonId);
    }
}
