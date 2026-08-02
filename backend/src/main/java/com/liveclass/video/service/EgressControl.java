package com.liveclass.video.service;

import java.util.List;
import java.util.Optional;

/**
 * LiveKit Egress 제어 포트. 라이브 방을 HLS로 녹화 시작/중지하고 상태를 조회한다(ADR-0010, songjeongki/0020,
 * choinhoo/0002 §4). 실패는 {@link EgressControlException}으로 감싸 던진다 — 호출자가 처리 정책을 정한다.
 */
public interface EgressControl {

    /**
     * 방 컴포지트 HLS 녹화 시작.
     *
     * @param roomName     LiveKit 방 이름
     * @param objectPrefix 저장소 객체 키 프리픽스(세션별 경로). 세그먼트·플레이리스트가 이 밑에 쌓인다.
     * @return LiveKit egress 작업 ID(중지·조회에 사용)
     */
    String startHlsRecording(String roomName, String objectPrefix);

    /** 녹화 중지. 대상이 이미 없으면(중복 중지 등) 성공으로 간주(멱등). */
    void stopRecording(String egressId);

    /**
     * Gate B(ADR-0002 §4) — Egress 작업의 현재 상태. LiveKit이 그 작업을 모르면 {@link Optional#empty()}.
     * 조회 자체가 실패하면 {@link EgressControlException}을 던진다 — 호출자가 "모름"과 "실패"를 구분한다.
     */
    Optional<EgressState> findState(String egressId);

    /**
     * StartEgress 응답 유실을 재조정하기 위해 방의 현재 STARTING/ACTIVE Egress를 찾는다.
     * 하나보다 많으면 구현체가 오류를 던져 중복 상태를 숨기지 않는다.
     */
    Optional<EgressSnapshot> findActiveForRoom(String roomName);

    /**
     * 전역으로 진행 중(STARTING/ACTIVE)인 모든 Egress를 나열한다 — 운영/디버그용(관리 콘솔).
     * 방 단위가 아니라 서버 전체를 훑어, 끝난 방에 남은 "유령 Egress"(전역 슬롯을 잡아먹는)를 찾아 정지하는 데 쓴다.
     */
    List<ActiveEgress> listActive();

    /**
     * 종료된 Egress의 <b>결과</b>까지 조회한다(상태 + 세그먼트 산출물). 완료 webhook이 오지 않아 자산이
     * FINALIZING에 멈춰 있을 때 서버에 직접 물어 확정하는 복구 경로다. LiveKit이 그 작업을 모르면 empty.
     *
     * <p>{@link #findState}와 나눈 이유는 확정에 상태만으로는 부족해서다 — 길이·크기·세그먼트 수가 없으면
     * 자산이 READY가 되어도 재생 메타가 비어 화면이 반쪽이 된다.
     */
    Optional<EgressResult> findResult(String egressId);

    record EgressSnapshot(String egressId, EgressState state) {
    }

    /**
     * @param state        현재 상태
     * @param durationMs   세그먼트 길이(ms). 알 수 없으면 null
     * @param sizeBytes    산출물 크기(byte). 알 수 없으면 null
     * @param segmentCount 세그먼트 수. 알 수 없으면 null
     * @param error        실패 사유. 성공이면 null 또는 빈 문자열
     */
    record EgressResult(EgressState state, Long durationMs, Long sizeBytes, Integer segmentCount, String error) {
    }

    /** 관리 콘솔 표시용 진행 중 Egress 한 건(egressId·방·상태·시작시각ms). */
    record ActiveEgress(String egressId, String roomName, EgressState state, long startedAtMs) {
    }

    /** LiveKit {@code EgressStatus}를 그대로 옮긴 경계 enum. */
    enum EgressState {
        EGRESS_STARTING,
        EGRESS_ACTIVE,
        EGRESS_ENDING,
        EGRESS_COMPLETE,
        EGRESS_FAILED,
        EGRESS_ABORTED,
        EGRESS_LIMIT_REACHED,
        UNKNOWN;

        /** 더 기다려도 ACTIVE가 되지 않는 상태 — 즉시 실패로 접는다. */
        public boolean terminalFailure() {
            return this == EGRESS_FAILED || this == EGRESS_ABORTED || this == EGRESS_LIMIT_REACHED;
        }
    }
}
