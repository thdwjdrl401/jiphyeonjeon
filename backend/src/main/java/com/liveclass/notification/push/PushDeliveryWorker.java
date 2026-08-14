package com.liveclass.notification.push;

import com.liveclass.notification.config.NotificationMessagingConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

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

    public PushDeliveryWorker(PushDeliveryProgressRepository progressRepository,
                              WebPushSender pushSender) {
        this.progressRepository = progressRepository;
        this.pushSender = pushSender;
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
        /*
         * 반환값은 **이번 호출에서 시도를 마친 사람들**이다(성공·실패·구독 없음 불문).
         * batch-timeout으로 응답을 못 본 기기의 주인은 여기 없으므로 기록되지 않고,
         * 이 메서드가 끝까지 가도 그 사람들은 재배달이 다시 집는다.
         */
        Set<UUID> attempted = pushSender.send(remaining, command.title(), command.body(), command.url());
        progressRepository.settle(command.eventHash(), attempted);
        log.info("푸시 전달 type={} event={} 명단={} 발송대상={} 시도완료={}",
                command.type(), command.eventHash(), command.recipientIds().size(),
                remaining.size(), attempted.size());
    }
}
