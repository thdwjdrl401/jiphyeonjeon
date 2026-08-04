package com.liveclass.live.web;

import com.liveclass.asset.api.AssetDirectory;
import com.liveclass.live.domain.AnnotationHighlight;
import com.liveclass.live.service.AnnotationHighlightService;
import com.liveclass.live.web.dto.AnnotationHighlightRequest;
import com.liveclass.live.web.dto.AnnotationHighlightResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 강조 판서 캡처(ADR-0074).
 *
 * <p>강사가 강조 툴로 화면 일부를 표시하면 브라우저가 그 순간의 화면 + 판서를 합성해 자르고, 에셋으로
 * 올린 뒤 그 {@code assetId}를 여기로 보낸다. <b>서버는 이미지 바이트를 만지지 않는다</b> — 영상
 * 프레임은 브라우저에만 있고, 서버는 무엇이 언제 잡혔는지를 기록한다.
 *
 * <p>전부 <b>소유 강사 전용</b>이다. 이 캡처는 영실이 근거로 색인될 것이라 수강생이 넣을 수 있으면 안 되고,
 * 아직 확인 전인 것이 학생 화면에 노출될 이유도 없다.
 */
@Tag(name = "라이브 판서", description = "판서 op 적재·복원(REST). 실시간 전달은 LiveKit 데이터 채널로 별개.")
@RestController
public class AnnotationHighlightController {

    private final AnnotationHighlightService highlightService;
    private final AssetDirectory assetDirectory;

    public AnnotationHighlightController(AnnotationHighlightService highlightService,
                                         AssetDirectory assetDirectory) {
        this.highlightService = highlightService;
        this.assetDirectory = assetDirectory;
    }

    @Operation(summary = "강조 판서 캡처 저장",
            description = "강조 툴로 표시한 영역의 합성 크롭(화면 + 판서)을 근거 후보로 남긴다. "
                    + "시각(sessionMs)은 서버가 정한다 — 클라이언트 시계를 믿으면 다시보기 앵커가 어긋난다.")
    @PostMapping("/api/live-sessions/{sessionId}/annotation/highlights")
    @ResponseStatus(HttpStatus.CREATED)
    public AnnotationHighlightResponse capture(@PathVariable UUID sessionId,
                                               @Valid @RequestBody AnnotationHighlightRequest request,
                                               Authentication authentication) {
        AnnotationHighlight saved = highlightService.capture(
                sessionId, UUID.fromString(authentication.getName()),
                request.assetId(), request.interpretedText());
        return AnnotationHighlightResponse.of(saved, assetDirectory.resolveUrl(saved.getAssetId()).orElse(null));
    }

    @Operation(summary = "강조 판서 캡처 목록",
            description = "이 세션에서 잡힌 캡처를 시각순으로. 근거에서 뺀 것은 담지 않는다.")
    @GetMapping("/api/live-sessions/{sessionId}/annotation/highlights")
    public List<AnnotationHighlightResponse> list(@PathVariable UUID sessionId, Authentication authentication) {
        List<AnnotationHighlight> highlights =
                highlightService.list(sessionId, UUID.fromString(authentication.getName()));
        // 썸네일 URL은 한 번에 해석한다 — 캡처마다 부르면 목록 길이만큼 스토리지 호출이 나간다.
        Map<UUID, String> urls = assetDirectory.resolveUrls(
                highlights.stream().map(AnnotationHighlight::getAssetId).toList());
        return highlights.stream()
                .map(highlight -> AnnotationHighlightResponse.of(highlight, urls.get(highlight.getAssetId())))
                .toList();
    }

    @Operation(summary = "강조 판서 캡처 제외",
            description = "근거에서 뺀다(소프트, 멱등). **지우개와는 무관하다** — 강조 스트로크를 지우는 것은 "
                    + "슬라이드가 넘어가 화면과 안 맞는다는 뜻이지 그 내용이 틀렸다는 뜻이 아니다.")
    @DeleteMapping("/api/live-sessions/{sessionId}/annotation/highlights/{highlightId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void remove(@PathVariable UUID sessionId, @PathVariable UUID highlightId,
                       Authentication authentication) {
        highlightService.remove(sessionId, UUID.fromString(authentication.getName()), highlightId);
    }
}
