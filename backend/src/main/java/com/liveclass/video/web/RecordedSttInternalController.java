package com.liveclass.video.web;

import com.liveclass.video.service.RecordedSttContractException;
import com.liveclass.video.service.RecordedSttInternalService;
import com.liveclass.video.web.dto.MediaSourceUrlResponse;
import com.liveclass.video.web.dto.RecordedSttCallbackEvent;
import com.liveclass.video.web.dto.RecordedSttChunkRequest;
import com.liveclass.video.web.dto.RecordedSttProgressResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.json.JsonMapper;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

@RestController
public class RecordedSttInternalController {

    private static final int MAX_CHUNK_BODY_BYTES = 2 * 1024 * 1024;
    private static final int MAX_CALLBACK_BODY_BYTES = 64 * 1024;

    private final RecordedSttWorkerVerifier verifier;
    private final RecordedSttInternalService service;
    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    public RecordedSttInternalController(RecordedSttWorkerVerifier verifier,
                                         RecordedSttInternalService service) {
        this.verifier = verifier;
        this.service = service;
    }

    @PostMapping(value = "/api/internal/ai/recorded-stt-jobs/{jobId}/source-url",
            consumes = MediaType.ALL_VALUE)
    public MediaSourceUrlResponse sourceUrl(@PathVariable UUID jobId,
                                            @RequestBody(required = false) byte[] body,
                                            @RequestHeader(value = "X-Signature", required = false) String signature) {
        verifier.verifySource(body, signature);
        return new MediaSourceUrlResponse(service.issueSourceUrl(jobId));
    }

    @GetMapping("/api/internal/ai/recorded-stt-jobs/{jobId}/progress")
    public RecordedSttProgressResponse progress(
            @PathVariable UUID jobId,
            @RequestHeader(value = "X-Signature", required = false) String signature) {
        verifier.verifyCallback(new byte[0], signature);
        return service.progress(jobId);
    }

    @PutMapping(value = "/api/internal/ai/recorded-stt-jobs/{jobId}/chunks/{chunkIndex}",
            consumes = MediaType.APPLICATION_JSON_VALUE)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void chunk(@PathVariable UUID jobId, @PathVariable int chunkIndex,
                      @RequestBody(required = false) byte[] body,
                      @RequestHeader(value = "X-Signature", required = false) String signature) {
        requireBody(body, MAX_CHUNK_BODY_BYTES, "STT 청크");
        verifier.verifyCallback(body, signature);
        RecordedSttChunkRequest request = parse(body, RecordedSttChunkRequest.class, "STT 청크");
        service.acceptChunk(jobId, chunkIndex, request, body);
    }

    @PostMapping(value = "/api/internal/ai/recorded-stt-callbacks",
            consumes = MediaType.APPLICATION_JSON_VALUE)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void callback(@RequestBody(required = false) byte[] body,
                         @RequestHeader(value = "X-Signature", required = false) String signature) {
        requireBody(body, MAX_CALLBACK_BODY_BYTES, "STT callback");
        verifier.verifyCallback(body, signature);
        RecordedSttCallbackEvent event = parse(body, RecordedSttCallbackEvent.class, "STT callback");
        service.handleTerminal(event, new String(body, StandardCharsets.UTF_8));
    }

    private void requireBody(byte[] body, int maxBytes, String name) {
        if (body == null || body.length == 0 || body.length > maxBytes) {
            throw new RecordedSttContractException(
                    "RECORDED_STT_PAYLOAD_INVALID", name + " 본문 크기가 올바르지 않습니다.", false);
        }
    }

    private <T> T parse(byte[] body, Class<T> type, String name) {
        try {
            return jsonMapper.readValue(body, type);
        } catch (RuntimeException e) {
            throw new RecordedSttContractException(
                    "RECORDED_STT_PAYLOAD_INVALID", name + " JSON이 올바르지 않습니다.", false);
        }
    }
}
