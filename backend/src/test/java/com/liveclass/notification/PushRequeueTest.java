package com.liveclass.notification;

import com.liveclass.aiintegration.api.OutboxPublisher;
import com.liveclass.notification.push.PushDeliveryCommand;
import com.liveclass.notification.push.PushDeliveryProgressRepository;
import com.liveclass.notification.push.PushDeliveryWorker;
import com.liveclass.notification.push.WebPushSender;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import tools.jackson.databind.json.JsonMapper;

import java.time.Duration;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 못 보낸 사람이 <b>실제로 다시 시도되는지</b>를 본다(ADR-0128).
 *
 * <p>진행 표에 안 적는 것만으로는 부족하다. 이 소비자가 정상 종료하면 메시지는 ack되어 사라지므로,
 * 안 적고 끝내면 결과는 적고 끝낸 것과 같다 — 둘 다 그 사람은 못 받는다. 다시 싣는 이 한 걸음이
 * 있어야 "기록하지 않는다"가 의미를 갖는다.
 *
 * <p>발송기와 아웃박스는 가짜다. 여기서 확인할 것은 HTTP도 DB도 아니라 <b>이 소비자의 판단</b>이다.
 */
class PushRequeueTest {

    private static final JsonMapper JSON = JsonMapper.builder().build();
    /** 브로커가 재배달 표시를 안 단 상태. 정상 경로다. */
    private static final Boolean NOT_REDELIVERED = null;

    private PushDeliveryProgressRepository progress;
    private WebPushSender sender;
    private OutboxPublisher outbox;

    private final UUID event = UUID.randomUUID();
    private final UUID delivered = UUID.randomUUID();
    private final UUID blocked = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        progress = mock(PushDeliveryProgressRepository.class);
        sender = mock(WebPushSender.class);
        outbox = mock(OutboxPublisher.class);
    }

    private PushDeliveryWorker worker(int maxAttempts) {
        return new PushDeliveryWorker(progress, sender, outbox, maxAttempts, 30_000);
    }

    private String commandJson(int attempt, List<UUID> recipients) {
        return JSON.writeValueAsString(new PushDeliveryCommand(
                "MATERIAL_PUBLISHED", event, recipients, "제목", "본문", null, attempt));
    }

    private void given(Set<UUID> settled, Set<UUID> unfinished, Duration retryAfter) {
        when(progress.remaining(any(), any()))
                .thenReturn(List.of(delivered, blocked));
        when(sender.send(any(), any(), any(), any()))
                .thenReturn(new WebPushSender.SendResult(settled, unfinished, retryAfter));
    }

    @Test
    @DisplayName("막힌 사람은 기록되지 않고 다음 시도로 다시 실린다")
    void the_blocked_recipient_is_requeued_and_not_recorded() {
        given(Set.of(delivered), Set.of(blocked), null);

        worker(4).handle(commandJson(1, List.of(delivered, blocked)), NOT_REDELIVERED);

        // 기록은 끝난 사람만.
        verify(progress).settle(eq(event), eq(Set.of(delivered)));

        ArgumentCaptor<String> payload = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Duration> delay = ArgumentCaptor.forClass(Duration.class);
        verify(outbox).enqueueAfter(anyString(), anyString(), anyString(), anyString(),
                payload.capture(), anyString(), any(), delay.capture());

        PushDeliveryCommand requeued = JSON.readValue(payload.getValue(), PushDeliveryCommand.class);
        assertThat(requeued.recipientIds())
                .as("막힌 사람만 다시 싣는다 — 받은 사람을 끼우면 그 기기가 두 번 운다")
                .containsExactly(blocked);
        assertThat(requeued.attemptOrFirst()).isEqualTo(2);
        assertThat(delay.getValue())
                .as("상대가 말한 게 없으면 기본 대기")
                .isEqualTo(Duration.ofSeconds(30));
    }

    @Test
    @DisplayName("상대가 알려 준 Retry-After가 기본 대기를 이긴다")
    void the_providers_retry_after_wins_over_our_default() {
        given(Set.of(delivered), Set.of(blocked), Duration.ofSeconds(120));

        worker(4).handle(commandJson(1, List.of(delivered, blocked)), NOT_REDELIVERED);

        ArgumentCaptor<Duration> delay = ArgumentCaptor.forClass(Duration.class);
        verify(outbox).enqueueAfter(anyString(), anyString(), anyString(), anyString(),
                anyString(), anyString(), any(), delay.capture());
        assertThat(delay.getValue()).isEqualTo(Duration.ofSeconds(120));
    }

    @Test
    @DisplayName("상한에 닿으면 포기한다 — 같은 명단이 큐를 영원히 돌지 않는다")
    void the_requeue_stops_at_the_attempt_limit() {
        given(Set.of(delivered), Set.of(blocked), null);

        worker(4).handle(commandJson(4, List.of(delivered, blocked)), NOT_REDELIVERED);

        verify(progress).settle(eq(event), eq(Set.of(delivered)));
        verify(outbox, never()).enqueueAfter(anyString(), anyString(), anyString(), anyString(),
                anyString(), anyString(), any(), any());
    }

    @Test
    @DisplayName("전원 끝났으면 다시 싣지 않는다")
    void nothing_is_requeued_when_everyone_finished() {
        given(Set.of(delivered, blocked), Set.of(), null);

        worker(4).handle(commandJson(1, List.of(delivered, blocked)), NOT_REDELIVERED);

        verify(outbox, never()).enqueueAfter(anyString(), anyString(), anyString(), anyString(),
                anyString(), anyString(), any(), any());
    }

    /**
     * 한 사건이 여러 조각으로 갈라져 오고 그 조각들이 같은 회차에 함께 막히면, 사건 해시만으로 만든
     * 멱등키는 겹친다 — 두 번째 조각이 아웃박스 UNIQUE에 걸려 <b>조용히 버려진다</b>. 남은 명단의
     * 가장 작은 id를 붙여 가른다.
     */
    @Test
    @DisplayName("같은 사건의 다른 조각은 멱등키가 겹치지 않는다")
    void two_slices_of_one_event_get_distinct_idempotency_keys() {
        UUID otherSliceBlocked = UUID.randomUUID();

        when(progress.remaining(any(), any())).thenReturn(List.of(blocked));
        when(sender.send(any(), any(), any(), any()))
                .thenReturn(new WebPushSender.SendResult(Set.of(), Set.of(blocked), null))
                .thenReturn(new WebPushSender.SendResult(Set.of(), Set.of(otherSliceBlocked), null));

        PushDeliveryWorker worker = worker(4);
        worker.handle(commandJson(1, List.of(blocked)), NOT_REDELIVERED);
        worker.handle(commandJson(1, List.of(otherSliceBlocked)), NOT_REDELIVERED);

        ArgumentCaptor<String> keys = ArgumentCaptor.forClass(String.class);
        verify(outbox, org.mockito.Mockito.times(2)).enqueueAfter(anyString(), anyString(), anyString(),
                anyString(), anyString(), keys.capture(), any(), any());
        assertThat(keys.getAllValues()).doesNotHaveDuplicates();
    }

    /**
     * 정상 경로에서는 진행 표를 보지 않는다.
     *
     * <p>처음 배달되는 첫 시도면 이 사건의 이 조각에 대해 아무도 발송을 마치지 않았다 —
     * 조각끼리 명단이 겹치지 않고 같은 사건이 두 번 실리지도 않는다. 그런데 그 조회가
     * 발송 경로 DB 시간의 61%였다(ADR-0137).
     */
    @Test
    @DisplayName("첫 배달·첫 시도면 진행 표를 조회하지 않는다")
    void first_delivery_skips_the_progress_check() {
        when(sender.send(any(), any(), any(), any()))
                .thenReturn(new WebPushSender.SendResult(Set.of(delivered, blocked), Set.of(), null));

        worker(4).handle(commandJson(1, List.of(delivered, blocked)), NOT_REDELIVERED);

        verify(progress, never()).remaining(any(), any());
        // 조회를 건너뛰었어도 명령이 싣고 온 명단 그대로 보낸다.
        verify(sender).send(eq(List.of(delivered, blocked)), any(), any(), any());
    }

    /** 재배달은 앞선 처리가 발송까지 하고 기록 전에 죽었을 수 있다. 그때는 봐야 한다. */
    @Test
    @DisplayName("재배달이면 진행 표를 조회한다")
    void redelivery_checks_the_progress() {
        when(progress.remaining(any(), any())).thenReturn(List.of(blocked));
        when(sender.send(any(), any(), any(), any()))
                .thenReturn(new WebPushSender.SendResult(Set.of(blocked), Set.of(), null));

        worker(4).handle(commandJson(1, List.of(delivered, blocked)), Boolean.TRUE);

        verify(progress).remaining(eq(event), eq(List.of(delivered, blocked)));
        // 이미 끝난 delivered는 빠지고 blocked에게만 간다.
        verify(sender).send(eq(List.of(blocked)), any(), any(), any());
    }

    /** 두 번째 이후 시도는 막힌 사람만 골라 다시 실은 명령이라 이미 끝난 사람이 섞일 수 있다. */
    @Test
    @DisplayName("두 번째 시도면 진행 표를 조회한다")
    void later_attempt_checks_the_progress() {
        when(progress.remaining(any(), any())).thenReturn(List.of(blocked));
        when(sender.send(any(), any(), any(), any()))
                .thenReturn(new WebPushSender.SendResult(Set.of(blocked), Set.of(), null));

        worker(4).handle(commandJson(2, List.of(delivered, blocked)), NOT_REDELIVERED);

        verify(progress).remaining(eq(event), eq(List.of(delivered, blocked)));
    }
}
