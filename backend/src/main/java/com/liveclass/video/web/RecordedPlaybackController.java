package com.liveclass.video.web;

import com.liveclass.video.service.RecordedPlaybackService;
import com.liveclass.video.web.dto.RecordedPlaybackResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;
import java.nio.charset.StandardCharsets;

@Tag(name = "녹화강의 재생", description = "업로드 녹화강의의 HLS 재생 정보와 manifest를 제공한다.")
@RestController
public class RecordedPlaybackController {

    private static final MediaType HLS_MEDIA_TYPE = MediaType.valueOf("application/vnd.apple.mpegurl");
    private static final MediaType WEBVTT_MEDIA_TYPE = new MediaType("text", "vtt", StandardCharsets.UTF_8);

    private final RecordedPlaybackService service;

    public RecordedPlaybackController(RecordedPlaybackService service) {
        this.service = service;
    }

    @Operation(summary = "녹화강의 재생 정보")
    @GetMapping("/api/lessons/{lessonId}/recorded-playback")
    public RecordedPlaybackResponse playback(@PathVariable UUID lessonId, Authentication authentication) {
        return service.playback(currentUserId(authentication), lessonId);
    }

    @Operation(summary = "녹화강의 HLS 재생목록")
    @GetMapping("/api/lessons/{lessonId}/recorded-playback/manifest")
    public ResponseEntity<String> manifest(@PathVariable UUID lessonId, Authentication authentication) {
        return ResponseEntity.ok()
                .contentType(HLS_MEDIA_TYPE)
                .cacheControl(CacheControl.noStore())
                .body(service.manifest(currentUserId(authentication), lessonId));
    }

    @Operation(summary = "게시된 녹화강의 WebVTT 자막")
    @GetMapping("/api/lessons/{lessonId}/recorded-playback/captions/{trackId}.vtt")
    public ResponseEntity<String> captions(@PathVariable UUID lessonId,
                                           @PathVariable UUID trackId,
                                           Authentication authentication) {
        return ResponseEntity.ok()
                .contentType(WEBVTT_MEDIA_TYPE)
                .cacheControl(CacheControl.noStore())
                .body(service.captionWebVtt(currentUserId(authentication), lessonId, trackId));
    }

    private UUID currentUserId(Authentication authentication) {
        return UUID.fromString(authentication.getName());
    }
}
