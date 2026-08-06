package com.liveclass.video.service;

/**
 * 유령 Egress 회수 포트 — LiveKit이 정지시킬 수 없는 작업 기록을 걷어낸다.
 *
 * <p>{@link EgressControl}과 나눈 이유는 <b>말하는 상대가 다르기 때문</b>이다. 정지는 LiveKit API로
 * 가지만, 회수는 LiveKit Redis를 직접 건드려야 한다 — LiveKit에 고아를 지우는 API가 없다.
 * 그 Redis는 EC2 로컬(127.0.0.1)에만 열려 있어 백엔드 컨테이너에서 직접 닿지 못하고,
 * 호스트에 둔 좁은 중계(infra/livekit/egress-purger)를 거친다.
 *
 * <p>구현이 없을 수도 있다(중계를 배포하지 않은 환경). 그때는 {@link #isAvailable()}이 false이고
 * 콘솔은 "이 환경에서는 자동 회수를 쓸 수 없다"고 알린다 — 조용히 실패하지 않는다.
 */
public interface EgressOrphanPurge {

    /** 이 배포에서 자동 회수를 쓸 수 있는가(중계 주소·시크릿이 설정되어 있는가). */
    boolean isAvailable();

    /**
     * 유령 기록을 지운다.
     *
     * <p><b>호출 전에 유령임이 확인되어야 한다.</b> 다만 중계도 지우기 직전에 StopEgress로 다시
     * 확인하므로, 살아 있는 녹화가 잘못 지워지는 일은 이 경로로는 일어나지 않는다.
     *
     * @throws EgressControlException 중계와 통신하지 못했거나 중계가 거부한 경우
     */
    void purgeOrphan(String egressId);
}
