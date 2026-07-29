package com.liveclass.live.domain;

/**
 * 라이브 시작 attempt가 마지막으로 영속한 단계(ADR-0002 §3).
 *
 * <p>비동기 실행기가 죽어도 재조정기가 같은 attempt를 다시 실행할 수 있게 하는 운영 진단값이다.
 * 외부 작업 자체는 Dispatch metadata와 video_asset/egressId로 멱등 재조회한다.
 */
public enum LiveStartStep {
    ACCEPTED,
    STT_DISPATCHED,
    EGRESS_STARTING,
    EGRESS_READY,
    PUBLISHER_RECHECK,
    LIVE,
    FAILED
}
