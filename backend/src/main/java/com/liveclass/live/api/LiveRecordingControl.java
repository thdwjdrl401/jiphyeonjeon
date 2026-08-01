package com.liveclass.live.api;

import java.util.UUID;

/**
 * 시작 오케스트레이터가 필요로 하는 <b>동기</b> 녹화 제어 포트(ADR-0002 §4 Gate A~C). 구현은 video 모듈이 제공한다.
 *
 * <p><b>왜 이벤트가 아니라 동기 포트인가</b>: ADR-0020은 Egress를 이벤트 기반 best-effort로 분리했지만,
 * 학생 재생이 HLS 하나로 확정된 뒤로는(ADR-0032) Egress가 준비되지 않으면 학생이 볼 영상 자체가 없다.
 * ADR-0002 §1은 이 부분에서 ADR-0020을 대체한다고 선언했고, STARTING 오케스트레이터는 Gate B~C를
 * <b>기다렸다가</b> LIVE로 전환해야 하므로 결과를 돌려받는 동기 호출이 필요하다.
 *
 * <p><b>왜 포트가 live 쪽에 있는가</b>: video는 이미 {@code live.api}(세션 조회·시작/종료 이벤트·LiveKit
 * 접속 정보)에 의존한다. live가 {@code video.api}를 참조하면 두 모듈이 순환하게 되어 Modulith 경계 검증이
 * 깨진다. 그래서 포트를 소비자(live) 쪽에 두고 video가 구현한다 — 의존 방향은 video → live 하나로 유지된다.
 *
 * <p>종료 경로는 ADR choinhoo/0003에 따라 Room 삭제 다음 이 포트의 {@link #stopRecording(UUID)}을
 * 동기 순차 호출한다. 중지 실패는 라이브 {@code ENDED} 전이를 막지 않는다.
 */
public interface LiveRecordingControl {

    /**
     * Gate A — Egress API 수락. {@code video_asset}을 {@code REQUESTED → STARTING}으로 만든 뒤
     * {@code StartRoomCompositeEgress}를 호출하고 {@code egressId}를 즉시 저장한다. 멱등 —
     * 이미 진행 중인 자산이 있으면 그대로 성공으로 본다.
     *
     * @return Egress 시작이 수락되면 true, 명시적으로 실패하면 false(오케스트레이터가 시작을 접는다)
     */
    boolean startRecording(UUID sessionId, UUID lessonId, String roomName);

    /** Gate B~C — Egress 프로세스 활성 여부와 학생 재생 가능(manifest + 첫 segment) 여부를 한 번 조회한다. */
    EgressReadiness pollReadiness(UUID sessionId);

    /**
     * 시작 실패 정리. 원격 Egress가 있으면 멱등 중지하고 자산을 실패로 남긴다.
     * 예외를 던지지 않는다 — 정리 실패가 강사의 재시도를 막으면 안 된다.
     */
    void abortRecording(UUID sessionId, String failureCode);

    /**
     * 종료 오케스트레이터의 Egress 중지 보완 호출. 멱등이며, 녹화 자산의 후속 webhook·READY 수명주기는
     * 라이브 세션 상태와 독립적으로 진행한다.
     */
    void stopRecording(UUID sessionId);

    /**
     * Egress 준비 상태 스냅샷.
     *
     * @param active        Egress 프로세스가 {@code EGRESS_ACTIVE}인가(Gate B)
     * @param manifestReady HLS manifest와 첫 media segment가 저장소에 실재하는가(Gate C)
     * @param failed        {@code EGRESS_FAILED/ABORTED} 같은 terminal 상태라 더 기다릴 필요가 없는가
     * @param failureCode   {@code failed}일 때의 안정적인 오류 code
     */
    record EgressReadiness(boolean active, boolean manifestReady, boolean failed, String failureCode) {

        public boolean ready() {
            return active && manifestReady;
        }
    }
}
