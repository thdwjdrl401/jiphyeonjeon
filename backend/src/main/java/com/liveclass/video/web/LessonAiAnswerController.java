package com.liveclass.video.web;

import com.liveclass.video.service.LessonAiAnswerService;
import com.liveclass.video.web.dto.LessonAiQuestionRequest;
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

/**
 * 레슨 AI 질의응답 SSE 프록시(ADR-0015 · ADR-0075). 브라우저의 최소 입력을 서버가 ai-api Replay v2
 * wire로 바꿔 중계한다.
 *
 * <p><b>업로드 녹화강의와 라이브 다시보기가 이 경로 하나를 쓴다.</b> 사용자에게는 "보고 있는 강의에
 * 질문한다"는 한 가지 행동이고, 근거를 어디서 가져올지는 서버가 {@code deliveryType}으로 가른다
 * ({@link LessonAiAnswerService}). 라이브 <b>진행 중</b> 질문만 세션 경로
 * ({@code /api/live-sessions/{sessionId}/ai/answers/stream})를 따로 쓴다 — 그쪽은 "지금"이라 최신 자막
 * 좌표 하나면 되고 시간축이 다르다(ADR-0047).
 *
 * <p><b>경로가 {@code /stream}으로 끝나는 것은 계약이다.</b> {@code frontend/nginx/default.conf}의
 * {@code location ~ ^/api/.+/stream$}만 {@code proxy_buffering off}를 적용한다 — 다른 접미사면
 * nginx가 토큰을 뭉쳐 실시간 스트리밍이 깨진다.
 */
@Tag(name = "레슨 AI 질의응답", description = "게시된 강의의 자막·PPTX를 근거로 답변을 SSE로 중계한다.")
@RestController
public class LessonAiAnswerController {

    private final LessonAiAnswerService lessonAiAnswerService;

    public LessonAiAnswerController(LessonAiAnswerService lessonAiAnswerService) {
        this.lessonAiAnswerService = lessonAiAnswerService;
    }

    @Operation(summary = "레슨 AI 질문(SSE)",
            description = "ai-api의 answer.delta 0개 이상 + answer.done|answer.insufficient|answer.error 하나를 "
                    + "그대로 중계한다. curriculumId·자산 ID·자막 문맥·requestId는 서버가 채운다. "
                    + "접근 조건은 그 강의의 재생과 같다 — 소유 강사는 게시 전에도, 학생은 활성 수강 + 게시본만.")
    @PostMapping(value = "/api/lessons/{lessonId}/ai/answers/stream",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter stream(@PathVariable UUID lessonId,
                             @Valid @RequestBody LessonAiQuestionRequest request,
                             Authentication authentication) {
        UUID userId = UUID.fromString(authentication.getName());
        return lessonAiAnswerService.ask(userId, lessonId, request.question(), request.playbackMs());
    }
}
