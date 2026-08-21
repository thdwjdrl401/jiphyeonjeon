package com.liveclass.notification.push;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 동시 상한을 공급자 반응으로 옮기는 산술(ADR-0137).
 *
 * <p>목 서버로는 옳은 상한을 못 찾는다 — 속도 제한이 없어서 올리는 만큼 빨라진다(800 → 2,400에서
 * +20%). 실제 공급자는 429로 막으므로 값을 짐작하는 대신 <b>막히면 줄이고 안 막히면 늘린다.</b>
 *
 * <p>여기서 지키는 것은 둘이다. 경계를 넘지 않는 것과, 오르내리는 속도가 비대칭인 것.
 */
class WebPushInFlightGovernorTest {

    private static final int CEILING = 800;
    private static final int FLOOR = 100;
    private static final int STEP = 50;

    private static int next(int now, boolean pushedBack) {
        return WebPushSender.nextInFlight(now, pushedBack, CEILING, FLOOR, STEP);
    }

    @Test
    @DisplayName("공급자가 막으면 절반으로 줄인다")
    void push_back_halves_the_limit() {
        assertThat(next(800, true)).isEqualTo(400);
        assertThat(next(400, true)).isEqualTo(200);
    }

    @Test
    @DisplayName("깨끗하면 한 걸음씩 올린다")
    void a_clean_batch_grows_by_one_step() {
        assertThat(next(200, false)).isEqualTo(250);
        assertThat(next(250, false)).isEqualTo(300);
    }

    /** 바닥이 없으면 계속 반토막 나 결국 1이 되고, 그때는 조각 하나가 영원히 안 끝난다. */
    @Test
    @DisplayName("아무리 막혀도 바닥 아래로는 안 내려간다")
    void the_floor_holds() {
        assertThat(next(FLOOR, true)).isEqualTo(FLOOR);
        assertThat(next(120, true)).isEqualTo(FLOOR);
    }

    /** 천장은 max-in-flight다. 연결 수를 그 값에 맞춰 잡아 뒀으므로 넘으면 스트림이 모자란다. */
    @Test
    @DisplayName("아무리 깨끗해도 천장 위로는 안 올라간다")
    void the_ceiling_holds() {
        assertThat(next(CEILING, false)).isEqualTo(CEILING);
        assertThat(next(CEILING - 10, false)).isEqualTo(CEILING);
    }

    /**
     * 내려가는 폭이 올라가는 폭보다 커야 한다.
     *
     * <p>반대면 상한 근처에서 429를 반복해서 맞는다 — 한 번 맞고 조금 내렸다가 곧바로 다시
     * 올라가 또 맞는다. 그 사이 거절당한 사람들은 다음 회차까지 못 받는다.
     */
    @Test
    @DisplayName("내려가는 폭이 올라가는 폭보다 크다")
    void it_backs_off_faster_than_it_grows() {
        int from = 800;
        int down = from - next(from, true);
        int up = next(from - down, false) - (from - down);
        assertThat(down).isGreaterThan(up);
    }
}
