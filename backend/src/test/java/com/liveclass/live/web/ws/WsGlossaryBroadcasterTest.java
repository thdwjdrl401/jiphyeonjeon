package com.liveclass.live.web.ws;

import com.liveclass.learning.api.LessonGlossaryChangedEvent;
import com.liveclass.live.domain.LiveSession;
import com.liveclass.live.domain.LiveSessionStatus;
import com.liveclass.live.repository.LiveSessionRepository;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 용어집 갱신 전파 규칙.
 *
 * <p>지키려는 것: <b>지금 화면이 열려 있을 수 있는 세션에만 보낸다</b>는 것과, 라이브가 없어도
 * 조용히 지나간다는 것. 자료 임베딩 콜백은 라이브와 무관하게 아무 때나 도착하므로, 여기서 터지면
 * 콜백 처리 전체가 실패한다.
 */
class WsGlossaryBroadcasterTest {

    private final SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
    private final LiveSessionRepository repository = mock(LiveSessionRepository.class);
    private final WsGlossaryBroadcaster broadcaster = new WsGlossaryBroadcaster(messagingTemplate, repository);

    private static final UUID LESSON_ID = UUID.randomUUID();

    private static LiveSession sessionWith(LiveSessionStatus status) {
        LiveSession session = new LiveSession();
        session.setId(UUID.randomUUID());
        session.setLessonId(LESSON_ID);
        session.setStatus(status);
        return session;
    }

    private static LessonGlossaryChangedEvent event() {
        return new LessonGlossaryChangedEvent(LESSON_ID, LessonGlossaryChangedEvent.Reason.MATERIAL_KEY_TERMS);
    }

    @Test
    void 진행_중인_세션에는_전용_토픽으로_보낸다() {
        LiveSession session = sessionWith(LiveSessionStatus.LIVE);
        when(repository.findByLessonId(LESSON_ID)).thenReturn(Optional.of(session));

        broadcaster.onGlossaryChanged(event());

        verify(messagingTemplate).convertAndSend(
                eqDestination("/topic/live-sessions/" + session.getId() + "/glossary"), any(Object.class));
    }

    @Test
    void 끝난_세션에는_보내지_않는다() {
        // 다시보기는 열 때마다 새로 읽는다 — 듣는 사람이 없는 토픽에 밀어 넣을 이유가 없다.
        when(repository.findByLessonId(LESSON_ID)).thenReturn(Optional.of(sessionWith(LiveSessionStatus.ENDED)));

        broadcaster.onGlossaryChanged(event());

        verify(messagingTemplate, never()).convertAndSend(anyString(), any(Object.class));
    }

    @Test
    void 아직_열리지_않은_세션에도_보내지_않는다() {
        when(repository.findByLessonId(LESSON_ID)).thenReturn(Optional.of(sessionWith(LiveSessionStatus.SCHEDULED)));

        broadcaster.onGlossaryChanged(event());

        verify(messagingTemplate, never()).convertAndSend(anyString(), any(Object.class));
    }

    @Test
    void 라이브가_아예_없으면_조용히_지나간다() {
        // 자료 임베딩 콜백은 라이브와 무관하게 도착한다. 여기서 터지면 콜백 처리 전체가 실패한다.
        when(repository.findByLessonId(LESSON_ID)).thenReturn(Optional.empty());

        broadcaster.onGlossaryChanged(event());

        verify(messagingTemplate, never()).convertAndSend(anyString(), any(Object.class));
    }

    @Test
    void 입장창이_열린_세션에도_보낸다() {
        // 시작 전에 들어와 있는 수강생도 같은 화면을 보고 있다.
        for (LiveSessionStatus status : new LiveSessionStatus[]{
                LiveSessionStatus.OPEN, LiveSessionStatus.STARTING, LiveSessionStatus.LIVE}) {
            SimpMessagingTemplate template = mock(SimpMessagingTemplate.class);
            LiveSessionRepository repo = mock(LiveSessionRepository.class);
            when(repo.findByLessonId(LESSON_ID)).thenReturn(Optional.of(sessionWith(status)));

            new WsGlossaryBroadcaster(template, repo).onGlossaryChanged(event());

            verify(template).convertAndSend(anyString(), any(Object.class));
        }
    }

    @Test
    void 용어_원문은_싣지_않는다() {
        LiveSession session = sessionWith(LiveSessionStatus.LIVE);
        when(repository.findByLessonId(LESSON_ID)).thenReturn(Optional.of(session));

        broadcaster.onGlossaryChanged(event());

        // payload에 용어를 실으면 조회에 걸린 인가(ensureCanViewInsights)를 우회하게 된다.
        var captor = org.mockito.ArgumentCaptor.forClass(Object.class);
        verify(messagingTemplate).convertAndSend(anyString(), captor.capture());
        WsEnvelope envelope = (WsEnvelope) captor.getValue();
        assertThat(envelope.type()).isEqualTo("lesson.glossary.updated");
        assertThat(envelope.payload()).isInstanceOf(WsGlossaryBroadcaster.GlossaryChangedPayload.class);
        var payload = (WsGlossaryBroadcaster.GlossaryChangedPayload) envelope.payload();
        assertThat(payload.lessonId()).isEqualTo(LESSON_ID.toString());
        assertThat(payload.reason()).isEqualTo("MATERIAL_KEY_TERMS");
    }

    /** convertAndSend(String, Object) 오버로드를 고르기 위한 매처. */
    private static String eqDestination(String destination) {
        return org.mockito.ArgumentMatchers.eq(destination);
    }
}
