package com.liveclass.video.service;

import com.liveclass.video.service.EgressControl.StopOutcome;
import org.junit.jupiter.api.Test;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * StopEgress 실패 응답을 어떻게 읽을지 고정한다. <b>이 매핑이 운영 콘솔이 거짓말을 하느냐를 가른다.</b>
 *
 * <p>근거는 2026-08-05 운영 로그다. 같은 "정지 안 됨"이 두 가지로 나뉘어 찍혔다.
 * <pre>
 * API Egress.StopEgress  status 412  "egress with status EGRESS_FAILED cannot be stopped"
 * API Egress.StopEgress  status 408  "request timed out"   ← 앞서 "no response from servers"
 * </pre>
 * 앞은 이미 끝난 것이고 뒤는 소유 노드가 사라진 것이다. 전에는 둘 다 502로 던져 콘솔이 구분하지 못했다.
 */
class LiveKitEgressStopOutcomeTest {

    /**
     * 404와 412는 "이미 멈춰 있다"는 같은 사실의 다른 표현이다. 목록을 보고 누른 시점과 작업이 끝난
     * 시점이 겹치는 일은 정상이라, 중복 정지를 오류로 올리면 멀쩡한 조작이 빨간불이 된다.
     */
    @Test
    void 이미_끝난_작업은_멱등하게_접는다() {
        assertThat(LiveKitEgressControl.stopOutcomeFor(404)).contains(StopOutcome.ALREADY_ENDED);
        assertThat(LiveKitEgressControl.stopOutcomeFor(412)).contains(StopOutcome.ALREADY_ENDED);
    }

    /**
     * 408만 유령이다 — LiveKit이 소유 핸들러에게 보낸 RPC에 아무도 대답하지 않은 경우.
     * 재시도해도 결과가 같으므로, 콘솔이 "다시 눌러도 소용없다"고 말할 수 있어야 한다.
     */
    @Test
    void 소유_노드가_응답하지_않으면_유령이다() {
        assertThat(LiveKitEgressControl.stopOutcomeFor(408)).contains(StopOutcome.ORPHANED);
    }

    /**
     * 모르는 실패는 접지 않는다. 여기서 넉넉하게 성공 처리하면 진짜 장애가 조용히 묻히고,
     * 운영자는 정지되지 않은 녹화를 정지됐다고 믿게 된다.
     */
    @Test
    void 모르는_실패는_접지_않고_호출자에게_넘긴다() {
        assertThat(LiveKitEgressControl.stopOutcomeFor(500)).isEmpty();
        assertThat(LiveKitEgressControl.stopOutcomeFor(503)).isEmpty();
        assertThat(LiveKitEgressControl.stopOutcomeFor(401)).isEmpty();
        assertThat(LiveKitEgressControl.stopOutcomeFor(429)).isEmpty();
    }

    /** 성공 응답은 이 매핑을 타지 않는다 — 200을 넣어도 "예상 밖"으로 남아야 한다. */
    @Test
    void 성공코드는_이_매핑의_대상이_아니다() {
        assertThat(LiveKitEgressControl.stopOutcomeFor(200)).isEqualTo(Optional.empty());
    }
}
