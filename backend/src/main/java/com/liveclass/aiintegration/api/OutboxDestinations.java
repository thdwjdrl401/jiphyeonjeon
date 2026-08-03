package com.liveclass.aiintegration.api;

/**
 * 아웃박스 이벤트가 실려 갈 목적지(=RabbitMQ 라우팅 키이자 큐 이름). 릴레이는 이 값을 <b>데이터로</b>
 * 읽어 분기하므로, 여기에 상수가 없어도 임의 목적지를 쓸 수 있다 — 문자열을 각자 흩뿌리지 않으려고
 * 발행 쪽이 공유하는 것만 모아 둔다.
 *
 * <p>알림 팬아웃 큐 이름은 여기에 두지 않는다. 그 큐는 {@code notification} 모듈이 선언하고 소비하며,
 * 이 모듈은 그 존재를 알 필요가 없다 — 아는 순간 의존이 거꾸로 흐른다.
 */
public final class OutboxDestinations {

    /** 자료 임베딩 잡(ADR-0036, CONTRACT §3-1). taskType은 payload로 구분한다. */
    public static final String INGESTION_EMBED = "ingestion.embed";

    private OutboxDestinations() {
    }
}
