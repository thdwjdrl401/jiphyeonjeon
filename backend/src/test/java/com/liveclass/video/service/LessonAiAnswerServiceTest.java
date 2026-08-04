package com.liveclass.video.service;

import com.liveclass.aiintegration.api.RagAnswerStreamHandle;
import com.liveclass.aiintegration.api.ReplayRagAnswerCommand;
import com.liveclass.lesson.api.LessonDetailView;
import com.liveclass.lesson.api.LessonDirectory;
import com.liveclass.video.api.PlaybackAccessException;
import org.junit.jupiter.api.Test;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * 레슨 AI 질문이 <b>어느 갈래로 가는지</b>를 고정한다(ADR-0075).
 *
 * <p>한 레슨은 업로드 녹화강의이거나 라이브이지 둘 다일 수 없으므로, 자산을 뒤져 추측하지 않고
 * {@code deliveryType} 하나로 가른다. 잘못 갈리면 <b>다른 강의의 자막</b>을 근거로 답하게 된다.
 */
class LessonAiAnswerServiceTest {

    private final LessonDirectory lessonDirectory = mock(LessonDirectory.class);
    private final RecordedAiAnswerService recorded = mock(RecordedAiAnswerService.class);
    private final ReplayAiAnswerService replay = mock(ReplayAiAnswerService.class);
    private final LessonAiAnswerService service =
            new LessonAiAnswerService(lessonDirectory, recorded, replay);

    private final UUID userId = UUID.randomUUID();
    private final UUID lessonId = UUID.randomUUID();

    @Test
    void recorded_lesson_goes_to_the_uploaded_video_branch() {
        givenDeliveryType("RECORDED");
        ReplayRagAnswerCommand command = command();
        RagAnswerStreamHandle handle = mock(RagAnswerStreamHandle.class);
        SseEmitter emitter = new SseEmitter();
        when(recorded.prepare(userId, lessonId, "질문", 12_000L)).thenReturn(command);
        when(recorded.open(command)).thenReturn(handle);
        when(recorded.relay(command, handle)).thenReturn(emitter);

        assertThat(service.ask(userId, lessonId, "질문", 12_000L)).isSameAs(emitter);

        verify(recorded).prepare(userId, lessonId, "질문", 12_000L);
        // 라이브 자막(live_caption)은 건드리지 않는다 — 이 레슨엔 라이브 세션이 없다.
        verifyNoInteractions(replay);
    }

    @Test
    void live_lesson_goes_to_the_replay_branch_and_records_the_answer() {
        givenDeliveryType("LIVE");
        ReplayRagAnswerCommand command = command();
        RagAnswerStreamHandle handle = mock(RagAnswerStreamHandle.class);
        SseEmitter emitter = new SseEmitter();
        when(replay.prepare(userId, lessonId, "질문", 12_000L)).thenReturn(command);
        when(replay.open(command)).thenReturn(handle);
        // askedBy를 넘긴다 = 답변이 라이브 질문과 같은 표에 쌓인다.
        when(replay.relay(command, handle, userId)).thenReturn(emitter);

        assertThat(service.ask(userId, lessonId, "질문", 12_000L)).isSameAs(emitter);

        verify(replay).relay(command, handle, userId);
        verifyNoInteractions(recorded);
    }

    @Test
    void unknown_lesson_is_hidden_as_not_found_before_any_branch_runs() {
        when(lessonDirectory.findDetail(any())).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.ask(userId, lessonId, "질문", 0L))
                .isInstanceOf(PlaybackAccessException.class)
                .satisfies(e -> assertThat(((PlaybackAccessException) e).reason())
                        .isEqualTo(PlaybackAccessException.Reason.NOT_FOUND));

        // 존재하지 않는 강의에 ai-api를 부르지 않는다.
        verifyNoInteractions(recorded, replay);
    }

    private void givenDeliveryType(String deliveryType) {
        when(lessonDirectory.findDetail(lessonId)).thenReturn(Optional.of(new LessonDetailView(
                lessonId, UUID.randomUUID(), "제목", "설명", 0, "PUBLISHED", deliveryType)));
    }

    private ReplayRagAnswerCommand command() {
        return new ReplayRagAnswerCommand("req-1", lessonId, UUID.randomUUID(), UUID.randomUUID(),
                "질문", 12_000L, List.of());
    }
}
