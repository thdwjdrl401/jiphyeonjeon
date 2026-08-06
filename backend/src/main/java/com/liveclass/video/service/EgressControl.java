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

    /**
     * 녹화 중지. <b>결말을 값으로 돌려준다</b> — 예외는 진짜 통신·서버 오류일 때만 던진다.
     *
     * <p>"정지되지 않았다"에는 성격이 다른 두 가지가 섞여 있어 하나로 뭉치면 운영자가 판단할 수 없다.
     * 이미 끝난 작업에 정지를 건 것은 <b>할 일이 없는 것</b>이고, 소유 노드가 사라진 작업은
     * <b>이 경로로는 영영 정지되지 않는 것</b>이다. 앞의 것을 오류로 올리면 콘솔이 멀쩡한 조작에
     * 빨간불을 띄우고, 뒤의 것을 성공으로 접으면 목록에 그대로 남아 운영자가 같은 버튼을 반복해서 누른다.
     *
     * @return {@link StopOutcome} — 호출자가 표시·후속 조치를 정한다
     */
    StopOutcome stopRecording(String egressId);

    /**
     * 정지 요청의 결말.
     *
     * <p>{@link #ORPHANED}는 LiveKit이 소유 핸들러에게 보낸 RPC에 아무도 대답하지 않은 경우다.
     * Egress 작업은 그것을 시작한 <b>핸들러 프로세스</b>가 소유하는데, 녹화 도중 egress 컨테이너가
     * 재시작되면 그 프로세스가 완료 보고 없이 사라진다. LiveKit은 작업을 ACTIVE로 계속 들고 있지만
     * 정지 요청을 받아 줄 상대가 없다 — 2026-08-05에 두 호스트에서 각각 한 건씩 실제로 생겼다.
     * LiveKit에 고아 회수 API가 없어 이 상태는 사람이 정리해야 한다.
     */
    enum StopOutcome {
        /** 정지 요청이 받아들여졌다. */
        STOPPED,
        /** 이미 끝났거나 LiveKit이 모르는 작업 — 정지할 것이 없다(멱등). */
        ALREADY_ENDED,
        /** 소유 노드가 사라져 이 경로로는 정지할 수 없다(유령). 수동 정리가 필요하다. */
        ORPHANED
    }

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
