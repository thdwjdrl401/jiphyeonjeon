package com.liveclass.video.web;

import com.liveclass.video.service.MediaTranscodeCallbackInvalidException;
import com.liveclass.video.service.MediaTranscodeInternalService;
import com.liveclass.video.web.dto.MediaSourceUrlResponse;
import com.liveclass.video.web.dto.MediaTranscodeCallbackEvent;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.json.JsonMapper;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

@RestController
public class MediaTranscodeInternalController {

    private final MediaWorkerVerifier verifier;
    private final MediaTranscodeInternalService service;
    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    public MediaTranscodeInternalController(MediaWorkerVerifier verifier, MediaTranscodeInternalService service) {
        this.verifier = verifier;
        this.service = service;
    }

    @PostMapping(value = "/api/internal/media/transcode-jobs/{jobId}/source-url", consumes = MediaType.ALL_VALUE)
    public MediaSourceUrlResponse sourceUrl(
            @PathVariable UUID jobId,
            @RequestBody(required = false) byte[] body,
            @RequestHeader(value = "X-Signature", required = false) String signature) {
        verifier.verifySource(body, signature);
        return new MediaSourceUrlResponse(service.issueSourceUrl(jobId));
    }

    @PostMapping(value = "/api/internal/media/transcode-callbacks", consumes = MediaType.ALL_VALUE)
    public void callback(
            @RequestBody(required = false) byte[] body,
            @RequestHeader(value = "X-Signature", required = false) String signature) {
        verifier.verifyCallback(body, signature);
        if (body == null || body.length == 0) {
            throw new MediaTranscodeCallbackInvalidException("callback 본문이 비어 있습니다.");
        }
        MediaTranscodeCallbackEvent event;
        try {
            event = jsonMapper.readValue(body, MediaTranscodeCallbackEvent.class);
        } catch (RuntimeException e) {
            throw new MediaTranscodeCallbackInvalidException("callback JSON이 올바르지 않습니다.");
        }
        service.handleCallback(event, new String(body, StandardCharsets.UTF_8));
    }
}
