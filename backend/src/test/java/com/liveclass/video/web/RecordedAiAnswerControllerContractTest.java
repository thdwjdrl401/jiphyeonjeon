package com.liveclass.video.web;

import com.liveclass.aiintegration.api.RagAnswerStreamHandle;
import com.liveclass.aiintegration.api.ReplayRagAnswerCommand;
import com.liveclass.video.service.RecordedAiAnswerService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.security.Principal;
import java.util.List;
import java.util.UUID;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Browser→Spring 공개 입력 계약: 내부 media ID는 받지 않고 lessonId·question·playbackMs만 사용한다. */
@WebMvcTest(RecordedAiAnswerController.class)
@AutoConfigureMockMvc(addFilters = false)
class RecordedAiAnswerControllerContractTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private RecordedAiAnswerService service;

    @Test
    void accepts_lesson_path_question_and_playback_ms_then_starts_sse() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID lessonId = UUID.randomUUID();
        ReplayRagAnswerCommand command = new ReplayRagAnswerCommand(
                "request-1", lessonId, UUID.randomUUID(), UUID.randomUUID(), "질문", 12_345L, List.of());
        RagAnswerStreamHandle handle = mock(RagAnswerStreamHandle.class);
        when(service.prepare(userId, lessonId, "질문", 12_345L)).thenReturn(command);
        when(service.open(command)).thenReturn(handle);
        when(service.relay(command, handle)).thenReturn(new SseEmitter());

        mockMvc.perform(post("/api/lessons/" + lessonId + "/ai/answers/stream")
                        .principal(principal(userId))
                        .contentType("application/json")
                        .accept("text/event-stream")
                        .content("{\"question\":\"질문\",\"playbackMs\":12345}"))
                .andExpect(status().isOk())
                .andExpect(request().asyncStarted());

        verify(service).prepare(userId, lessonId, "질문", 12_345L);
        verify(service).open(command);
        verify(service).relay(command, handle);
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

    private Principal principal(UUID userId) {
        return new TestingAuthenticationToken(userId.toString(), null);
    }
}
