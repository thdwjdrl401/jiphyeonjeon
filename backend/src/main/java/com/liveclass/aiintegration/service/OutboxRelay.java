package com.liveclass.aiintegration.service;

import com.liveclass.aiintegration.domain.OutboxEvent;
import com.liveclass.aiintegration.domain.OutboxStatus;
import com.liveclass.aiintegration.repository.OutboxEventRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * outbox → RabbitMQ 릴레이(ADR-0036). PENDING 잡을 읽어 큐에 발행하고 PUBLISHED로 표시한다.
 * 발행 실패는 attemptCount++·백오프로 재시도, {@link #MAX_ATTEMPTS} 초과 시 FAILED(사실상 DLQ 대기).
 *
 * <p>목적지는 이벤트마다 다르고({@code destination} 컬럼) 배치는 <b>목적지별로</b> 뽑는다 —
 * 한 목적지가 밀려도 다른 목적지가 굶지 않는다(ADR-0073 §4).
 *
 * <p><b>도는 계기가 둘이다</b>(ADR-0122). 잡이 실린 트랜잭션이 커밋되면
 * {@link OutboxRelayTrigger}가 곧바로 깨우고, 그와 별개로 스케줄러가 느리게 계속 돈다. 폴링은
 * 트리거가 닿지 않는 자리(백오프 대기·트리거 발사 직후의 죽음·다른 인스턴스의 커밋·기동 시 잔여
 * PENDING)를 위한 안전망이라 지우지 않는다.
 *
 * <p>그래서 이 메서드는 <b>동시에 두 번 돌 수 있다.</b> 같은 행을 둘이 집어 브로커로 두 번 보내지
 * 않도록 배치 조회가 {@code FOR UPDATE SKIP LOCKED}로 행을 잠근다.
 *
 * <p>발행 전용이라 큐 소비자(AI 워커)가 없어도 durable 큐에 메시지가 쌓인다. 스위치(material.embedding.enabled)가
 * 꺼져 있으면 애초에 outbox에 잡이 안 실리므로 이 릴레이는 빈 결과로 무해하게 돈다.
 */
@Component
public class OutboxRelay {

    private static final Logger log = LoggerFactory.getLogger(OutboxRelay.class);
    private static final int MAX_ATTEMPTS = 10;

    private final OutboxEventRepository outboxEventRepository;
    private final RabbitTemplate rabbitTemplate;

    public OutboxRelay(OutboxEventRepository outboxEventRepository, RabbitTemplate rabbitTemplate) {
        this.outboxEventRepository = outboxEventRepository;
        this.rabbitTemplate = rabbitTemplate;
    }

    /**
     * <b>목적지마다</b> 배치를 뽑는다. 전체에서 오래된 순으로 100건을 뽑던 방식은 한 목적지가 밀리면
     * 다른 목적지를 굶겼다 — 알림 팬아웃이 1,000건 쌓이면 방금 올린 자료의 임베딩 잡이 그 뒤에
     * 줄을 선다(머리 막힘). 목적지 수는 큐 종류만큼이라 조회가 하나 느는 값은 무시할 만하다.
     */
    @Scheduled(fixedDelayString = "${outbox.relay.fixed-delay-ms:30000}",
            initialDelayString = "${outbox.relay.initial-delay-ms:15000}")
    @Transactional
    public void publishPending() {
        OffsetDateTime cutoff = OffsetDateTime.now();
        List<Long> publishedIds = new ArrayList<>();
        for (String destination : outboxEventRepository.findPendingDestinations(OutboxStatus.PENDING, cutoff)) {
            List<OutboxEvent> batch = outboxEventRepository.lockPendingBatchForDestination(
                    OutboxStatus.PENDING.name(), destination, cutoff);
            for (OutboxEvent event : batch) {
                publishOne(event, publishedIds);
            }
        }
        markPublished(publishedIds);
    }

    /**
     * 성공분을 <b>한 문장으로</b> 넘긴다. 목적지를 가로질러 모아 두었다가 마지막에 한 번만 부른다 —
     * 어차피 한 트랜잭션이고, 목적지마다 부르면 문장 수가 목적지 수만큼 늘 뿐이다.
     *
     * <p>비어 있으면 아예 부르지 않는다. 빈 배열로 부르면 0행짜리 UPDATE 하나가 나가는 것도 문제지만,
     * 그보다 {@link OutboxEventRepository#markPublished}가 영속성 컨텍스트를 비우기 때문에
     * <b>할 일이 없는데도</b> 방금 읽은 것들을 도로 떼어 버린다.
     */
    private void markPublished(List<Long> publishedIds) {
        if (publishedIds.isEmpty()) {
            return;
        }
        outboxEventRepository.markPublished(publishedIds.toArray(Long[]::new));
    }

    /**
     * <b>성공분은 엔티티를 건드리지 않는다.</b> 상태 전환을 네이티브 UPDATE 한 문장으로 묶었으므로
     * ({@link OutboxEventRepository#markPublished}) 여기서 필드까지 고치면 더티 체킹이 같은 행에
     * 건별 UPDATE를 또 내보낸다 — 묶은 의미가 사라지고, 두 경로가 같은 행에 쓰는 모양이 된다.
     * 그래서 성공은 <b>id만</b> 모아 두고 실제 전환은 배치가 한다.
     *
     * <p>실패분은 반대로 엔티티를 고쳐 더티 체킹에 맡긴다. 행마다 값이 다르니 묶을 수가 없고,
     * 실패는 드물어 건별 UPDATE의 값이 싸다.
     */
    private void publishOne(OutboxEvent event, List<Long> publishedIds) {
        try {
            // 기본 익스체인지 + 라우팅키=큐이름. 목적지는 아웃박스 행이 들고 있다(ADR-0073 §4).
            rabbitTemplate.convertAndSend(event.getDestination(), event.getPayloadJson());
            publishedIds.add(event.getId());
            log.info("outbox 발행 id={} dest={} type={}",
                    event.getId(), event.getDestination(), event.getEventType());
        } catch (RuntimeException e) {
            int attempts = (event.getAttemptCount() == null ? 0 : event.getAttemptCount()) + 1;
            event.setAttemptCount(attempts);
            event.setLastError(e.getMessage());
            if (attempts >= MAX_ATTEMPTS) {
                event.setStatus(OutboxStatus.FAILED);
                log.warn("outbox 발행 {}회 실패 → FAILED id={}: {}", attempts, event.getId(), e.getMessage());
            } else {
                // 지수 백오프(상한 5분). 다음 폴링에서 재시도.
                long backoffSec = Math.min(300, (long) Math.pow(2, attempts));
                event.setNextAttemptAt(OffsetDateTime.now().plusSeconds(backoffSec));
                log.warn("outbox 발행 실패(재시도 {}s 뒤) id={}: {}", backoffSec, event.getId(), e.getMessage());
            }
        }
    }
}
