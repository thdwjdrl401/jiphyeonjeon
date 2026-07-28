package com.liveclass.live.domain;

/**
 * start attempt에 귀속된 realtime-agent 작업 상태.
 *
 * <p>{@code ASSUMED_RUNNING}은 {@code live.stt.assume-ready=true}인 임시 rollout 상태다. 실제
 * {@code JS_RUNNING/STT_READY}를 확인했다는 뜻이 아니며, Phase 4b에서 실제 상태로 대체한다.
 */
public enum LiveAgentJobStatus {
    DISABLED,
    DISPATCHED,
    ASSUMED_RUNNING,
    READY,
    FAILED,
    DELETED
}
