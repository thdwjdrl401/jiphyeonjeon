package com.liveclass.live.service;

import java.util.Optional;
import java.util.UUID;

/**
 * LiveKit explicit named AgentDispatch 제어 포트(CONTRACT §3-3, ADR-0002 §5). 자막 세션의 STT job을
 * "이 방에 이 agent를 붙여라"로 예약한다.
 *
 * <p>{@code live.stt.assume-ready=true}가 우회하는 것은 job/서비스 readiness 확인뿐이다. 실제 STT가
 * 붙을 기회 자체를 만드는 Dispatch 생성·재사용은 Phase 4a에서도 필수이며, 실패하면 호출자가 시작을 막는다.
 */
public interface AgentDispatchControl {

    /**
     * 같은 방·같은 metadata의 dispatch가 이미 있으면 재사용하고, 없으면 만든다(멱등).
     * 강사 재시도가 GPU slot을 중복 점유하지 않게 하는 지점이다.
     *
     * @return 생성·재사용된 dispatch ID. 조회·생성 실패면 {@link Optional#empty()}이고 시작은 실패해야 한다.
     */
    Optional<String> ensureDispatch(String room, String agentName, String metadataJson);

    /** 시작 실패 정리(멱등, best-effort). 대상이 없으면 조용히 넘어간다. */
    void deleteDispatch(String room, String dispatchId);

    /**
     * Python {@code JobMetadata}(ai/realtime-agent/app/jobs/metadata.py)와 <b>정확히 같은 4개 필드</b>만 담는
     * dispatch metadata. 미지 필드가 하나라도 있으면 agent가 job을 거부한다.
     */
    record DispatchMetadata(String contractVersion, UUID sessionId, UUID lessonId, String correlationId) {

        public static DispatchMetadata of(UUID sessionId, UUID lessonId, String correlationId) {
            return new DispatchMetadata("1", sessionId, lessonId, correlationId);
        }
    }
}
