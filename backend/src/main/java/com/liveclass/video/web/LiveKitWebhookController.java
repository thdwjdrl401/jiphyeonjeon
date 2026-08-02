package com.liveclass.video.web;

import com.liveclass.video.service.RecordingService;
import com.liveclass.video.web.dto.EgressWebhookEvent;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.json.JsonMapper;

/**
 * LiveKit egress 완료/실패 webhook 수신 (ADR-0034). SecurityConfig에서 permitAll이지만
 * {@link LiveKitWebhookVerifier}의 서명 검증이 실질 인증이다(외부에서 임의로 못 부른다).
 *
 * <p>본문은 <b>원시 바이트</b>로 받는다 — 프레임워크가 JSON으로 역/재직렬화하면 SHA-256이 어긋난다.
 * 검증을 통과한 뒤에만 파싱한다. 완료·실패는 모두 {@code egress_ended} 이벤트로 오고 status로 가른다.
 */
@Tag(name = "LiveKit Webhook", description = "egress 완료 신호를 받아 녹화 자산을 확정한다.")
@RestController
public class LiveKitWebhookController {

    private static final Logger log = LoggerFactory.getLogger(LiveKitWebhookController.class);
    private static final long NANOS_PER_MILLI = 1_000_000L;

    private final LiveKitWebhookVerifier verifier;
    private final RecordingService recordingService;
    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    public LiveKitWebhookController(LiveKitWebhookVerifier verifier, RecordingService recordingService) {
        this.verifier = verifier;
        this.recordingService = recordingService;
    }

    @Operation(summary = "LiveKit egress webhook",
            description = "egress 완료/실패 신호를 받아 VideoAsset을 READY 또는 FAILED로 확정하고, "
                    + "신규 정상 녹화는 READY와 ReplayStatus PUBLISHED를 함께 저장한다. 서명으로 인증한다.")
    @PostMapping(value = "/api/webhooks/livekit", consumes = MediaType.ALL_VALUE)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void onWebhook(@RequestBody(required = false) byte[] body,
                          @RequestHeader(value = "Authorization", required = false) String authorization) {
        verifier.verify(body, authorization);

        EgressWebhookEvent event = jsonMapper.readValue(body, EgressWebhookEvent.class);
        // egress 종료 이벤트만 다룬다. 시작/진행(egress_started·egress_updated)은 무시.
        if (event == null || !"egress_ended".equals(event.event()) || event.egressInfo() == null) {
            return;
        }
        EgressWebhookEvent.EgressInfo info = event.egressInfo();
        boolean success = "EGRESS_COMPLETE".equals(info.status());

        Long durationMs = null;
        Long sizeBytes = null;
        Integer segmentCount = null;
        if (info.segmentResults() != null && !info.segmentResults().isEmpty()) {
            // 세그먼트 출력은 보통 하나(index.m3u8). duration은 나노초라 ms로 환산한다.
            EgressWebhookEvent.SegmentResult seg = info.segmentResults().get(0);
            durationMs = parseLong(seg.duration()) == null ? null : parseLong(seg.duration()) / NANOS_PER_MILLI;
            sizeBytes = parseLong(seg.size());
            segmentCount = seg.segmentCount();
        }
        String failureCode = success ? null
                : (info.error() != null && !info.error().isBlank() ? "EGRESS_FAILED: " + info.error() : "EGRESS_FAILED");

        recordingService.completeFromWebhook(info.egressId(), success, durationMs, sizeBytes, segmentCount, failureCode);
        log.info("egress webhook 처리 egressId={} status={}", info.egressId(), info.status());
    }

    private Long parseLong(String s) {
        if (s == null || s.isBlank()) {
            return null;
        }
        try {
            return Long.parseLong(s);
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
