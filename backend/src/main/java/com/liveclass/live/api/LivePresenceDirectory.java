package com.liveclass.live.api;

import java.util.List;
import java.util.UUID;

/**
 * 라이브 접속 현황 조회 포트. 다른 모듈은 live의 집계 구현에 접근하지 않고 이것만 쓴다(모듈 경계).
 *
 * <p><b>왜 LiveKit이 아니라 이 포트인가</b>: 수강생은 LiveKit 방에 들어오지 않는다(ADR-0032 —
 * 학생 재생은 HLS 단일). {@code listParticipants}로는 강사·Egress·STT 에이전트만 보여서, 그것을
 * 접속자로 보여 주면 청중과 무관한 목록이 된다. 강의실을 연 사람은 반드시 세션 토픽을 구독하므로
 * 구독이 유일하게 정확한 접속 신호다.
 *
 * <p>돌려주는 것은 <b>조회 시점의 현황</b>이라 DB에 없다. 지나간 접속 이력을 묻는 포트가 아니다.
 */
public interface LivePresenceDirectory {

    /**
     * 지금 이 라이브에 들어와 있는 사람들. 강사도 포함해서 돌려주고 <b>구분해서 표시한다</b> —
     * 세는 것({@code audienceCount})과 달리 목록은 "강사가 들어와 있는지"도 답해야 한다.
     *
     * @return 들어온 순서(먼저 들어온 사람이 앞). 아무도 없으면 빈 목록
     */
    List<LivePresentUser> presentIn(UUID liveSessionId);
}
