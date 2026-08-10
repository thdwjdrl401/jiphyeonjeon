package com.liveclass.live.api;

/**
 * LiveKit 방의 수명 신호를 받는 포트. 신호는 우리가 만들지 않고 <b>LiveKit이 준다</b>.
 *
 * <p>webhook을 받는 곳은 video 모듈인데 세션 상태는 live 모듈이 갖는다. 그 사이를 잇는 것이 이
 * 포트다 — video가 live의 내부 서비스를 부르지 않고 이 문 하나만 두드린다.
 */
public interface LiveRoomLifecycle {

    /**
     * 그 방이 닫혔다. 방에 걸린 세션이 아직 진행 계열이면 종료로 확정한다.
     *
     * <p><b>모르는 방 이름은 조용히 무시한다.</b> 같은 LiveKit 서버를 다른 용도로 쓰면 우리 규칙과
     * 다른 이름의 방이 닫힐 수 있고, 그건 오류가 아니라 남의 일이다.
     *
     * @param roomName LiveKit이 알려 준 방 이름
     */
    void onRoomFinished(String roomName);
}
