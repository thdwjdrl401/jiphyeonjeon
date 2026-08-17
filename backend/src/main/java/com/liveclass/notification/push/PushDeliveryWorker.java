package com.liveclass.notification.push;

import com.liveclass.aiintegration.api.OutboxPublisher;
import com.liveclass.notification.config.NotificationMessagingConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * 푸시 전달 소비자(ADR-0124). 명령에서 명단을 꺼내 진행 표와 대조하고, <b>아직 안 보낸 사람만</b>
 * 발송한 뒤 시도를 마친 사람을 기록한다.
 *
 * <p>팬아웃 워커와 <b>다른 리스너 팩토리</b>를 쓴다 — 푸시(조각당 최대 60초)가 팬아웃 소비자를
 * 붙잡아 삽입 처리량을 끌어내리던 결합을 푸는 것이 이 클래스의 존재 이유다.
 *
 * <p><b>못 보낸 사람은 기록하지 않고 다시 싣는다</b>(ADR-0128). 푸시 서비스가 429로 막으면 그
 * 사람은 못 받은 것이므로 "시도를 마쳤다"가 아니다. 기록하면 anti-join이 그 사람을 영영 걸러
 * 내므로 조용한 영구 유실이 된다. 그렇다고 기록만 안 하고 끝내도 같다 — 이 메서드가 정상 종료하면
 * 메시지는 ack되어 사라지고, 아무도 그들을 다시 집지 않는다. 그래서 <b>남은 명단을 새 명령으로
 * 아웃박스에 다시 싣는다.</b> 아웃박스를 쓰는 것은 지연 발행(429가 준 Retry-After만큼 미루기)과
 * 멱등키가 거기 이미 있기 때문이다.
 *
 * <p><b>트랜잭션을 걸지 않는다.</b> 가운데가 HTTP 대량 발송이라 트랜잭션을 걸면 커넥션을 60초까지
 * 붙잡는다. 진행 조회와 기록은 각각 자기 문장으로 끝나고, 그 사이의 크래시 의미론은 이렇다.
 * <ul>
 *   <li>발송 전에 죽으면 — 기록이 없으므로 재배달이 전원을 다시 집는다. 유실 없음.</li>
 *   <li>발송 후 기록 전에 죽으면 — 재배달이 그 사람들을 다시 보내 <b>일부가 두 번 울린다</b>.
 *       "조용한 유실"보다 "가끔 두 번"을 고른 것이다(ADR-0124).</li>
 *   <li>기록 후 ack 전에 죽으면 — 재배달의 anti-join이 전원을 걸러 아무 일도 없다.</li>
 * </ul>
 */
@Component
public class PushDeliveryWorker {

    private static final Logger log = LoggerFactory.getLogger(PushDeliveryWorker.class);
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final PushDeliveryProgressRepository progressRepository;
    private final WebPushSender pushSender;
    private final OutboxPublisher outboxPublisher;
    private final int maxAttempts;
    private final Duration retryDelay;

    public PushDeliveryWorker(PushDeliveryProgressRepository progressRepository,
                              WebPushSender pushSender,
                              OutboxPublisher outboxPublisher,
                              @Value("${notification.push.max-delivery-attempts:4}") int maxAttempts,
                              @Value("${notification.push.retry-delay-ms:30000}") long retryDelayMs) {
        this.progressRepository = progressRepository;
        this.pushSender = pushSender;
        this.outboxPublisher = outboxPublisher;
        this.maxAttempts = maxAttempts;
        this.retryDelay = Duration.ofMillis(retryDelayMs);
    }

    @RabbitListener(queues = NotificationMessagingConfig.PUSH_QUEUE,
            containerFactory = "notificationPushListenerContainerFactory")
    public void handle(String payload) {
        PushDeliveryCommand command = JSON.readValue(payload, PushDeliveryCommand.class);
        List<UUID> remaining = progressRepository.remaining(command.eventHash(), command.recipientIds());
        if (remaining.isEmpty()) {
            // 재배달인데 전원이 이미 끝났다 — 기록 후 ack 전에 죽었던 메시지다. 조용히 ack한다.
            log.debug("푸시 재배달 전원 완료 event={} 명단={}", command.eventHash(), command.recipientIds().size());
            return;
        }
        WebPushSender.SendResult result =
                pushSender.send(remaining, command.title(), command.body(), command.url());
        progressRepository.settle(command.eventHash(), result.settled());
        log.info("푸시 전달 type={} event={} 시도={} 명단={} 발송대상={} 완료={} 미완={}",
                command.type(), command.eventHash(), command.attemptOrFirst(),
                command.recipientIds().size(), remaining.size(),
                result.settled().size(), result.unfinished().size());
        requeueUnfinished(command, result);
    }

    /**
     * 못 보낸 사람들을 다음 번째 시도로 다시 싣는다.
     *
     * <p>미루는 시간은 <b>상대가 말한 값이 이긴다</b>. 429의 {@code Retry-After}는 "이만큼 뒤에
     * 오라"는 그쪽의 답이고, 우리 기본 대기보다 그쪽이 정확하다. 말해 주지 않았으면 기본값을 쓴다.
     *
     * <p>상한에 닿으면 <b>포기하고 경고를 남긴다.</b> 진행 표에는 기록하지 않는다 — 기록하면 "보냈다"가
     * 되어 나중에 같은 사건을 다시 시도할 길까지 막힌다. 대신 로그에 사람 수를 남겨 유실이 조용하지
     * 않게 한다. 상한이 없으면 푸시 서비스가 계속 막을 때 같은 명단이 큐를 영원히 돈다.
     */
    private void requeueUnfinished(PushDeliveryCommand command, WebPushSender.SendResult result) {
        if (result.unfinished().isEmpty()) {
            return;
        }
        int attempt = command.attemptOrFirst();
        if (attempt >= maxAttempts) {
            log.warn("푸시 재시도 상한 도달 — 포기 event={} 시도={}/{} 못보낸사람={}",
                    command.eventHash(), attempt, maxAttempts, result.unfinished().size());
            return;
        }
        List<UUID> stillUnfinished = new ArrayList<>(result.unfinished());
        // 멱등키를 만들 때 쓴다. 정렬해 두면 같은 집합이 항상 같은 키를 낳는다.
        stillUnfinished.sort(UUID::compareTo);

        Duration delay = result.retryAfter() != null ? result.retryAfter() : retryDelay;
        PushDeliveryCommand next = command.nextAttempt(stillUnfinished);
        outboxPublisher.enqueueAfter(
                NotificationMessagingConfig.PUSH_QUEUE,
                "notification_push",
                command.eventHash().toString(),
                "PUSH_DELIVERY_REQUESTED",
                JSON.writeValueAsString(next),
                /*
                 * 사건 해시만으로는 부족하다 — 한 사건이 여러 조각으로 갈라져 오고, 그 조각들이
                 * 같은 회차에 함께 막히면 키가 겹쳐 두 번째 조각이 조용히 버려진다. 남은 명단의
                 * 가장 작은 id를 붙여 조각을 가른다(조각끼리 명단이 겹치지 않으므로 최솟값도 다르다).
                 */
                "push:" + command.eventHash() + ":retry:" + next.attemptOrFirst()
                        + ':' + stillUnfinished.getFirst(),
                null,
                delay);
        log.info("푸시 재시도 적재 event={} 다음시도={} 대상={} {}초 뒤",
                command.eventHash(), next.attemptOrFirst(), stillUnfinished.size(), delay.toSeconds());
    }
}
