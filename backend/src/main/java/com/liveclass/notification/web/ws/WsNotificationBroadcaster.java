package com.liveclass.notification.web.ws;

import com.liveclass.notification.push.WebPushSender;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.messaging.simp.user.SimpUserRegistry;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * 새 알림을 <b>지금 접속해 있는</b> 사람에게 즉시 알린다(ADR-0073 5단계).
 *
 * <p>목적지는 {@code /user/queue/notifications}다. Spring이 이 목적지를 <b>세션의 Principal로</b>
 * 해석하므로 남의 알림을 구독할 방법이 없다 — 토픽처럼 구독 인가 목록을 늘리지 않아도 된다.
 *
 * <p><b>내용을 싣지 않는다.</b> 신호만 보내고 화면이 목록·개수를 다시 읽는다. 이유는 둘이다.
 * <ol>
 *   <li>넓은 팬아웃은 <b>집합 삽입</b>이라 앱에 행 데이터가 없다. 내용을 실으려면 방금 넣은 행을
 *       도로 읽어야 하고, 그러면 팬아웃 한 조각마다 조회가 하나 더 붙는다.</li>
 *   <li>알림 모양이 두 곳(REST 응답·WS 페이로드)에 생기면 한쪽만 고치는 어긋남이 자란다.</li>
 * </ol>
 * 값은 화면이 조회를 한 번 더 하는 것인데, 그건 어차피 알림함을 열 때 하는 일이다.
 *
 * <p><b>접속한 사람에게만 보낸다.</b> 안 보내도 브로커가 버리지만, 100만 명 팬아웃에서 그 호출을
 * 100만 번 하는 것과 접속자 수만큼 하는 것은 다르다.
 */
@Component
public class WsNotificationBroadcaster {

    private static final Logger log = LoggerFactory.getLogger(WsNotificationBroadcaster.class);

    /** 화면이 구독하는 목적지. {@code /user} 접두사는 Spring이 붙인다. */
    public static final String DESTINATION = "/queue/notifications";

    private final SimpMessagingTemplate messagingTemplate;
    private final SimpUserRegistry userRegistry;
    private final WebPushSender pushSender;

    public WsNotificationBroadcaster(SimpMessagingTemplate messagingTemplate,
                                     SimpUserRegistry userRegistry,
                                     WebPushSender pushSender) {
        this.messagingTemplate = messagingTemplate;
        this.userRegistry = userRegistry;
        this.pushSender = pushSender;
    }

    /** 한 명에게. 좁은 팬아웃(수강 판정·녹화)이 쓴다. */
    public void announce(UUID recipientId, String notificationType, String title, String body) {
        if (recipientId == null) {
            return;
        }
        announceAll(List.of(recipientId), notificationType, title, body);
    }

    /**
     * 방금 <b>새로</b> 받은 사람들에게. 중복으로 걸러진 사람은 여기 없다.
     *
     * <p>두 층으로 나간다 — <b>STOMP</b>는 탭이 열려 있는 사람에게 즉시, <b>Web Push</b>는 탭을
     * 닫은 사람에게도. 둘 다 보내는 이유는 어느 쪽이 닿을지 서버가 알 수 없기 때문이다. 탭이 열려
     * 있으면 둘 다 오지만, 서비스워커가 <b>화면이 떠 있을 때는 시스템 알림을 띄우지 않는</b>다.
     */
    public void announceAll(Collection<UUID> recipientIds, String notificationType,
                            String title, String body) {
        if (recipientIds.isEmpty()) {
            return;
        }
        afterCommit(() -> deliver(recipientIds, notificationType, title, body));
    }

    /**
     * <b>커밋된 뒤에 보낸다.</b> 알림을 넣은 트랜잭션 안에서 신호를 보내면, 화면이 그 신호를 받고
     * 목록을 다시 읽을 때 <b>그 행이 아직 커밋되지 않아</b> 옛 데이터가 온다 — 신호는 갔는데
     * 배지가 그대로이고, 60초 폴링이나 새로고침에서야 보인다(운영에서 실제로 그랬다).
     *
     * <p>푸시도 함께 미룬다. 트랜잭션이 롤백되면 <b>없는 알림에 대한 푸시</b>를 보낸 셈이 된다.
     *
     * <p>트랜잭션 밖에서 부르면 곧바로 보낸다 — 기다릴 커밋이 없다.
     */
    private void afterCommit(Runnable send) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            send.run();
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                send.run();
            }
        });
    }

    private void deliver(Collection<UUID> recipientIds, String notificationType,
                         String title, String body) {
        /*
         * 푸시를 먼저 띄운다. 여기서 실패해도 STOMP는 나가야 하고, 반대도 마찬가지다 —
         * 전달 층 하나가 죽었다고 다른 층까지 멈추면 안 된다.
         */
        pushSender.send(recipientIds, title, body, null);
        NotificationSignalPayload payload =
                new NotificationSignalPayload(notificationType, OffsetDateTime.now());
        int sent = 0;
        for (UUID recipientId : recipientIds) {
            String user = recipientId.toString();
            if (userRegistry.getUser(user) == null) {
                continue;   // 접속해 있지 않다 — 알림함에 쌓여 있다가 다음에 열 때 보인다.
            }
            /*
             * 한 사람에게 실패해도 나머지는 보낸다. 실시간 전달은 <b>거들 뿐</b>이고 알림 자체는
             * 이미 저장돼 있다 — 여기서 예외를 올리면 워커가 조각 전체를 재시도한다.
             */
            try {
                messagingTemplate.convertAndSendToUser(user, DESTINATION, payload);
                sent++;
            } catch (RuntimeException e) {
                log.warn("실시간 알림 전송 실패 recipient={}: {}", recipientId, e.getMessage());
            }
        }
        if (sent > 0) {
            log.debug("실시간 알림 전송 type={} 접속자={}/{}", notificationType, sent, recipientIds.size());
        }
    }
}
