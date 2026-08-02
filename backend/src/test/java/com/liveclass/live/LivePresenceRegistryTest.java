package com.liveclass.live;

import com.liveclass.live.service.LivePresenceRegistry;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 접속자 집계 규칙.
 *
 * <p>수강생은 LiveKit 방에 들어오지 않으므로(ADR-0032) 방 참여자 목록으로는 청중을 셀 수 없다.
 * 세션 토픽 구독을 세되, <b>강사를 빼고 사람 단위로</b> 센다는 것이 이 집계의 계약이다.
 */
class LivePresenceRegistryTest {

    private final LivePresenceRegistry registry = new LivePresenceRegistry();

    @Test
    void counts_students_and_excludes_the_instructor() {
        UUID session = UUID.randomUUID();
        registry.join("ws-teacher", session, UUID.randomUUID(), true);
        registry.join("ws-student-1", session, UUID.randomUUID(), false);
        registry.join("ws-student-2", session, UUID.randomUUID(), false);

        // 강사가 포함되면 혼자일 때 1이 되어 "몇 명이 듣고 있는가"를 오해하게 만든다.
        assertThat(registry.audienceCount(session)).isEqualTo(2);
    }

    @Test
    void one_person_with_two_tabs_counts_once() {
        UUID session = UUID.randomUUID();
        UUID student = UUID.randomUUID();
        registry.join("ws-tab-1", session, student, false);
        registry.join("ws-tab-2", session, student, false);

        assertThat(registry.audienceCount(session)).isEqualTo(1);
    }

    @Test
    void leaving_one_tab_keeps_the_person_counted() {
        UUID session = UUID.randomUUID();
        UUID student = UUID.randomUUID();
        registry.join("ws-tab-1", session, student, false);
        registry.join("ws-tab-2", session, student, false);

        registry.leave("ws-tab-1");

        // 탭 하나를 닫았다고 강의실을 나간 것이 아니다.
        assertThat(registry.audienceCount(session)).isEqualTo(1);
        registry.leave("ws-tab-2");
        assertThat(registry.audienceCount(session)).isZero();
    }

    @Test
    void sessions_do_not_leak_into_each_other() {
        UUID a = UUID.randomUUID();
        UUID b = UUID.randomUUID();
        registry.join("ws-1", a, UUID.randomUUID(), false);
        registry.join("ws-2", b, UUID.randomUUID(), false);
        registry.join("ws-3", b, UUID.randomUUID(), false);

        assertThat(registry.audienceCount(a)).isEqualTo(1);
        assertThat(registry.audienceCount(b)).isEqualTo(2);
    }

    @Test
    void repeated_subscribe_on_one_connection_registers_once() {
        UUID session = UUID.randomUUID();
        UUID student = UUID.randomUUID();

        // 강의실은 한 연결로 chat·captions·state 세 토픽을 구독한다. 그때마다 알리면
        // 접속 한 번에 브로드캐스트가 세 번 나간다.
        assertThat(registry.join("ws-1", session, student, false)).isTrue();
        assertThat(registry.join("ws-1", session, student, false)).isFalse();
        assertThat(registry.join("ws-1", session, student, false)).isFalse();
    }

    @Test
    void leave_reports_which_session_to_announce() {
        UUID session = UUID.randomUUID();
        registry.join("ws-1", session, UUID.randomUUID(), false);

        assertThat(registry.leave("ws-1")).contains(session);
        // 모르는 연결이 끊겼다고 엉뚱한 세션에 알리지 않는다.
        assertThat(registry.leave("ws-unknown")).isEmpty();
    }
}
