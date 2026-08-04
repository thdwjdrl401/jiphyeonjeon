package com.liveclass.video.web;

import com.liveclass.aiintegration.api.RagAnswerStreamHandle;
import com.liveclass.aiintegration.api.ReplayRagAnswerCommand;
import com.liveclass.video.service.RecordedAiAnswerService;
import com.liveclass.video.web.dto.RecordedAiQuestionRequest;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.UUID;

/** 브라우저의 최소 입력을 서버가 Replay v2 wire로 변환하는 녹화강의 AI 진입점. */
@Tag(name = "녹화강의 AI 질의응답", description = "게시된 녹화강의의 자막·PPTX 기반 답변을 SSE로 중계한다.")
@RestController
public class RecordedAiAnswerController {

    private final RecordedAiAnswerService service;

    public RecordedAiAnswerController(RecordedAiAnswerService service) {
        this.service = service;
    }

    @Operation(summary = "녹화강의 AI 질문(SSE)",
            description = "lessonId로 recordedVideoId·curriculumId·게시 자막을 조회하고 ai-api Replay v2로 중계한다.")
    @PostMapping(value = "/api/lessons/{lessonId}/ai/answers/stream",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter stream(@PathVariable UUID lessonId,
                             @Valid @RequestBody RecordedAiQuestionRequest request,
                             Authentication authentication) {
        UUID userId = UUID.fromString(authentication.getName());
        ReplayRagAnswerCommand command = service.prepare(
                userId, lessonId, request.question(), request.playbackMs());
        RagAnswerStreamHandle handle = service.open(command);
        return service.relay(command, handle);
    }
}
