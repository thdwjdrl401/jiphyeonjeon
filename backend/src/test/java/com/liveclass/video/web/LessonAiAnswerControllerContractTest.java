package com.liveclass.video.web;

import com.liveclass.video.service.LessonAiAnswerService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.security.Principal;
import java.util.UUID;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Browser→Spring 공개 입력 계약: 내부 media ID는 받지 않고 {@code lessonId}·{@code question}·
 * {@code playbackMs}만 쓴다.
 *
 * <p>업로드 녹화강의냐 라이브 다시보기냐를 <b>컨트롤러는 모른다</b> — 갈림길은
 * {@link LessonAiAnswerService}가 {@code deliveryType}으로 정한다(ADR-0075).
 */
@WebMvcTest(LessonAiAnswerController.class)
@AutoConfigureMockMvc(addFilters = false)
class LessonAiAnswerControllerContractTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private LessonAiAnswerService service;

    @Test
    void accepts_lesson_path_question_and_playback_ms_then_starts_sse() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID lessonId = UUID.randomUUID();
        when(service.ask(userId, lessonId, "질문", 12_345L)).thenReturn(new SseEmitter());

        mockMvc.perform(post("/api/lessons/" + lessonId + "/ai/answers/stream")
                        .principal(principal(userId))
                        .contentType("application/json")
                        .accept("text/event-stream")
                        .content("{\"question\":\"질문\",\"playbackMs\":12345}"))
                .andExpect(status().isOk())
                .andExpect(request().asyncStarted());

        verify(service).ask(userId, lessonId, "질문", 12_345L);
    }

    @Test
    void rejects_negative_playback_time_before_calling_the_service() throws Exception {
        UUID lessonId = UUID.randomUUID();

        mockMvc.perform(post("/api/lessons/" + lessonId + "/ai/answers/stream")
                        .principal(principal(UUID.randomUUID()))
                        .contentType("application/json")
                        .accept("text/event-stream")
                        .content("{\"question\":\"질문\",\"playbackMs\":-1}"))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(service);
    }

    /**
     * 재생 위치가 없으면 거절한다. 예전에는 primitive {@code long}이라 누락이 조용히 0이 되어
     * "강의 맨 앞에서 물었다"로 답했다 — 어느 대목을 물었는지 모르는 채 답하느니 거절이 낫다.
     */
    @Test
    void rejects_missing_playback_time() throws Exception {
        UUID lessonId = UUID.randomUUID();

        mockMvc.perform(post("/api/lessons/" + lessonId + "/ai/answers/stream")
                        .principal(principal(UUID.randomUUID()))
                        .contentType("application/json")
                        .accept("text/event-stream")
                        .content("{\"question\":\"질문\"}"))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(service);
    }

    private Principal principal(UUID userId) {
        return new TestingAuthenticationToken(userId.toString(), null);
    }
}
