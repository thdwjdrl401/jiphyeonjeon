package com.liveclass.video.service;

/**
 * LiveKit Egress 제어 포트. 라이브 방을 HLS로 녹화 시작/중지한다(ADR-0010, songjeongki/0020).
 * 실패는 {@link EgressControlException}으로 감싸 던진다 — 호출자(RecordingService)가 best-effort로 처리한다.
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
}
