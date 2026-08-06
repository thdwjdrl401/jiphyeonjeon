package com.liveclass.notification;

import com.liveclass.notification.push.PushSubscriptionRepository;
import com.liveclass.notification.push.PushSubscriptionService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Web Push 구독 관리(ADR-0073 §9).
 *
 * <p>지키려는 것은 넷이다 — <b>재등록이 행을 늘리지 않는가</b>, <b>같은 기기로 다른 사람이 들어오면
 * 주인이 바뀌는가</b>, <b>남의 구독을 지울 수 없는가</b>, <b>키가 없을 때 조용히 꺼지는가</b>.
 *
 * <p>두 번째가 중요하다. 같은 브라우저에서 로그아웃하고 다른 계정으로 들어왔는데 주인이 그대로면
 * <b>이전 사용자의 알림이 이 기기로 계속 간다</b>.
 *
 * <p>실제 발송은 테스트하지 않는다. 브라우저 푸시 서비스로 나가는 HTTP라 목으로 바꿔도 확인되는
 * 것은 우리가 만든 목뿐이고, 암호화·서명은 라이브러리의 책임이다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class WebPushContractTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private PushSubscriptionService subscriptionService;
    @Autowired private PushSubscriptionRepository repository;
    @Autowired private JdbcTemplate jdbc;

    /** 브라우저는 이미 구독돼 있어도 다시 등록을 시도한다 — 권한 재확인·서비스워커 갱신 때가 그렇다. */
    @Test
    void registering_the_same_endpoint_twice_updates_instead_of_duplicating() {
        UUID user = seedUser();
        String endpoint = "https://push.example/" + UUID.randomUUID();

        subscriptionService.register(user, endpoint, "key-1", "auth-1", "Chrome");
        subscriptionService.register(user, endpoint, "key-2", "auth-2", "Chrome");

        assertThat(repository.findByUserId(user)).hasSize(1);
        assertThat(repository.findByEndpoint(endpoint).orElseThrow().getP256dh())
                .as("갱신이므로 마지막 키가 남는다")
                .isEqualTo("key-2");
    }

    /**
     * <b>같은 브라우저, 다른 계정.</b> 주인을 바꾸지 않으면 이전 사용자의 알림이 이 기기로 계속 간다.
     */
    @Test
    void re_registering_from_another_account_moves_the_device() {
        UUID first = seedUser();
        UUID second = seedUser();
        String endpoint = "https://push.example/" + UUID.randomUUID();

        subscriptionService.register(first, endpoint, "k", "a", "Chrome");
        subscriptionService.register(second, endpoint, "k", "a", "Chrome");

        assertThat(repository.findByUserId(first)).isEmpty();
        assertThat(repository.findByUserId(second)).hasSize(1);
    }

    /**
     * 엔드포인트만으로 지우게 두면 <b>남의 엔드포인트 문자열을 아는 사람이 그 기기의 알림을 끊을 수
     * 있다</b>. 자기 것만 지운다.
     */
    @Test
    void unregistering_someone_elses_endpoint_does_nothing() {
        UUID owner = seedUser();
        UUID attacker = seedUser();
        String endpoint = "https://push.example/" + UUID.randomUUID();
        subscriptionService.register(owner, endpoint, "k", "a", "Chrome");

        subscriptionService.unregister(attacker, endpoint);

        assertThat(repository.findByEndpoint(endpoint)).isPresent();
    }

    /**
     * <b>설정 화면의 켜짐·꺼짐이 여기에 달려 있다.</b>
     *
     * <p>브라우저는 로그아웃해도 구독 객체를 그대로 갖고 있다(로그아웃은 서버 행만 지운다). 그래서
     * 객체가 있다는 사실만으로 "켜짐"을 그리면 푸시가 오지 않는 브라우저가 켜진 것처럼 보인다.
     * 실제로 오는지는 서버에 이 엔드포인트가 <b>내 것으로</b> 있는가가 정한다.
     */
    @Test
    void a_subscription_is_mine_only_if_the_server_says_so() {
        UUID me = seedUser();
        UUID other = seedUser();
        String mine = "https://push.example/" + UUID.randomUUID();
        String theirs = "https://push.example/" + UUID.randomUUID();
        subscriptionService.register(me, mine, "k", "a", "Chrome");
        subscriptionService.register(other, theirs, "k", "a", "Chrome");

        assertThat(subscriptionService.isRegisteredFor(me, mine)).isTrue();
        assertThat(subscriptionService.isRegisteredFor(me, theirs))
                .as("남의 기기다 — 엔드포인트 문자열을 알아도 내 화면이 켜짐으로 보이면 안 된다")
                .isFalse();
        assertThat(subscriptionService.isRegisteredFor(me, "https://push.example/never-existed"))
                .as("로그아웃으로 서버 행이 지워진 브라우저가 이 경우다")
                .isFalse();
    }

    /** 없는 것을 지워도 성공이다 — 브라우저가 이미 구독을 버린 뒤 해제를 부르는 일이 흔하다. */
    @Test
    void unregistering_something_that_is_gone_is_not_an_error() {
        UUID user = seedUser();

        subscriptionService.unregister(user, "https://push.example/never-existed");
    }

    /**
     * 키가 설정돼 있지 않으면 공개키가 {@code null}이다. <b>404가 아니다</b> — 화면이 그걸 서버
     * 장애와 구별하지 못하면 푸시 UI를 숨길지 오류를 띄울지 정할 수 없다.
     */
    @Test
    void the_public_key_is_null_when_push_is_not_configured() throws Exception {
        mockMvc.perform(get("/api/me/push-subscriptions/public-key").with(loggedIn()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.publicKey").doesNotExist());
    }

    // ---- helpers ----

    private static org.springframework.test.web.servlet.request.RequestPostProcessor loggedIn() {
        return org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors
                .user(UUID.randomUUID().toString());
    }

    private UUID seedUser() {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.app_user (id, email, password_hash, display_name, role, status)
                VALUES (?, ?, 'x', ?, 'STUDENT', 'ACTIVE')
                """, id, "push-" + id + "@liveclass.test", "테스터");
        return id;
    }
}
