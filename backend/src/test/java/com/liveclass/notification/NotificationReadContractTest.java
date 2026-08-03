package com.liveclass.notification;

import com.liveclass.notification.api.NewNotification;
import com.liveclass.notification.api.NotificationTypes;
import com.liveclass.notification.service.NotificationService;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static com.liveclass.notification.domain.NotificationStatus.ACTION_REQUIRED;
import static com.liveclass.notification.domain.NotificationStatus.INFO;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 알림 조회 계약(CONTRACT §2-4, ADR-0073 1단계).
 *
 * <p>지키려는 것은 넷이다 — <b>두 축을 따로 겹치는가</b>, <b>개수가 필터와 무관한가</b>,
 * <b>읽음이 처리 축을 건드리지 않는가</b>, <b>남의 알림이 403이 아니라 404인가</b>.
 *
 * <p>알림은 아직 발행 지점이 없으므로(2단계) 서비스로 직접 만든다. 그 경로가 곧 팬아웃 워커가 쓸
 * 경로이므로, 여기서 <b>같은 사건의 재삽입이 한 건으로 접히는지</b>도 함께 본다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class NotificationReadContractTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private NotificationService notificationService;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    // ---- 목록 ----

    @Test
    void the_list_shows_only_my_notifications_newest_first() throws Exception {
        Account me = loginAs("INSTRUCTOR");
        Account other = loginAs("INSTRUCTOR");
        give(me, NotificationTypes.ENROLLMENT_REQUESTED, ACTION_REQUIRED, "첫 번째");
        give(me, NotificationTypes.LESSON_PUBLISHED, INFO, "두 번째");
        give(other, NotificationTypes.LESSON_PUBLISHED, INFO, "남의 것");

        mockMvc.perform(get("/api/me/notifications").cookie(me.cookies()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(2))
                // 최신이 위다.
                .andExpect(jsonPath("$.items[0].title").value("두 번째"))
                .andExpect(jsonPath("$.items[1].title").value("첫 번째"));
    }

    @Test
    void the_two_axes_are_filtered_separately_and_overlap() throws Exception {
        Account me = loginAs("INSTRUCTOR");
        give(me, NotificationTypes.ENROLLMENT_REQUESTED, ACTION_REQUIRED, "처리 대기 · 안 읽음");
        String readActionRequired = give(me, NotificationTypes.ENROLLMENT_REQUESTED, ACTION_REQUIRED, "처리 대기 · 읽음");
        give(me, NotificationTypes.LESSON_PUBLISHED, INFO, "소식 · 안 읽음");
        read(me, readActionRequired);

        // 하나의 enum으로 묶으면 물어볼 수 없는 조합이다 — "처리 대기 중 아직 안 읽은 것".
        mockMvc.perform(get("/api/me/notifications")
                        .param("scope", "ACTION_REQUIRED").param("readState", "UNREAD")
                        .cookie(me.cookies()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].title").value("처리 대기 · 안 읽음"));

        // 축을 생략하면 그 축으로 가리지 않는다.
        mockMvc.perform(get("/api/me/notifications").param("scope", "ACTION_REQUIRED").cookie(me.cookies()))
                .andExpect(jsonPath("$.items.length()").value(2));
        mockMvc.perform(get("/api/me/notifications").param("readState", "READ").cookie(me.cookies()))
                .andExpect(jsonPath("$.items.length()").value(1));
    }

    @Test
    void counts_ignore_the_filter() throws Exception {
        Account me = loginAs("INSTRUCTOR");
        give(me, NotificationTypes.ENROLLMENT_REQUESTED, ACTION_REQUIRED, "처리 대기");
        give(me, NotificationTypes.LESSON_PUBLISHED, INFO, "소식 하나");
        give(me, NotificationTypes.VOD_PUBLISHED, INFO, "소식 둘");

        /*
         * 목록은 걸러도 개수는 전체다. 이게 아니면 "모두 읽음" 직후 목록은 비었는데 배지만 남는
         * 어긋남이 생긴다.
         */
        mockMvc.perform(get("/api/me/notifications")
                        .param("scope", "ACTION_REQUIRED").cookie(me.cookies()))
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.unreadCount").value(3))
                .andExpect(jsonPath("$.actionRequiredCount").value(1));
    }

    @Test
    void the_page_is_bounded() throws Exception {
        Account me = loginAs("INSTRUCTOR");
        for (int i = 0; i < 12; i++) {
            give(me, NotificationTypes.LESSON_PUBLISHED, INFO, "알림 " + i);
        }

        // 무제한 응답을 주지 않는다(드롭다운 size=5, 알림 페이지 size=8).
        mockMvc.perform(get("/api/me/notifications").param("size", "5").cookie(me.cookies()))
                .andExpect(jsonPath("$.items.length()").value(5))
                .andExpect(jsonPath("$.totalElements").value(12))
                .andExpect(jsonPath("$.totalPages").value(3))
                .andExpect(jsonPath("$.hasNext").value(true));
    }

    // ---- 배지 ----

    @Test
    void the_badge_counts_are_per_recipient() throws Exception {
        Account me = loginAs("STUDENT");
        Account other = loginAs("STUDENT");
        give(me, NotificationTypes.VOD_PUBLISHED, INFO, "내 것");
        give(other, NotificationTypes.VOD_PUBLISHED, INFO, "남의 것");
        give(other, NotificationTypes.VOD_PUBLISHED, INFO, "남의 것 둘");

        mockMvc.perform(get("/api/me/notifications/summary").cookie(me.cookies()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.unreadCount").value(1))
                .andExpect(jsonPath("$.actionRequiredCount").value(0));
    }

    // ---- 읽음 ----

    @Test
    void reading_does_not_touch_the_action_axis() throws Exception {
        Account me = loginAs("INSTRUCTOR");
        String id = give(me, NotificationTypes.ENROLLMENT_REQUESTED, ACTION_REQUIRED, "수강 신청");

        /*
         * 여기가 이 기능의 핵심이다. 읽었다고 처리 축이 바뀌면 "처리 대기" 목록이 성립하지 않는다 —
         * 강사가 알림을 여는 순간 승인해야 할 신청이 목록에서 사라진다.
         */
        write(post("/api/me/notifications/" + id + "/read"), me.cookies(), null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.readStatus").value("READ"))
                .andExpect(jsonPath("$.actionStatus").value("ACTION_REQUIRED"))
                .andExpect(jsonPath("$.readAt").exists());

        mockMvc.perform(get("/api/me/notifications/summary").cookie(me.cookies()))
                .andExpect(jsonPath("$.unreadCount").value(0))
                .andExpect(jsonPath("$.actionRequiredCount").value(1));
    }

    @Test
    void reading_twice_is_not_an_error() throws Exception {
        Account me = loginAs("STUDENT");
        String id = give(me, NotificationTypes.VOD_PUBLISHED, INFO, "다시보기");

        write(post("/api/me/notifications/" + id + "/read"), me.cookies(), null).andExpect(status().isOk());
        write(post("/api/me/notifications/" + id + "/read"), me.cookies(), null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.readStatus").value("READ"));
    }

    @Test
    void marking_all_read_returns_the_updated_counts() throws Exception {
        Account me = loginAs("INSTRUCTOR");
        give(me, NotificationTypes.ENROLLMENT_REQUESTED, ACTION_REQUIRED, "수강 신청");
        give(me, NotificationTypes.LESSON_PUBLISHED, INFO, "소식");

        // 화면이 배지를 즉시 맞출 수 있어야 한다. 처리 대기는 그대로 남는다.
        write(post("/api/me/notifications/read-all"), me.cookies(), null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.unreadCount").value(0))
                .andExpect(jsonPath("$.actionRequiredCount").value(1));
    }

    // ---- 인가 ----

    @Test
    void someone_elses_notification_is_404_not_403() throws Exception {
        Account me = loginAs("STUDENT");
        Account other = loginAs("STUDENT");
        String theirs = give(other, NotificationTypes.VOD_PUBLISHED, INFO, "남의 알림");

        // 403을 주면 "그 알림이 존재한다"는 사실이 샌다.
        write(post("/api/me/notifications/" + theirs + "/read"), me.cookies(), null)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOTIFICATION_NOT_FOUND"));
    }

    @Test
    void a_missing_notification_looks_the_same_as_someone_elses() throws Exception {
        Account me = loginAs("STUDENT");

        write(post("/api/me/notifications/" + UUID.randomUUID() + "/read"), me.cookies(), null)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOTIFICATION_NOT_FOUND"));
    }

    @Test
    void a_guest_cannot_read_notifications() throws Exception {
        mockMvc.perform(get("/api/me/notifications")).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/me/notifications/summary")).andExpect(status().isUnauthorized());
    }

    // ---- 저장 ----

    @Test
    void the_same_event_is_kept_once() throws Exception {
        Account me = loginAs("INSTRUCTOR");
        NewNotification same = NewNotification.of(me.userId(), NotificationTypes.RECORDING_READY,
                INFO, NotificationTypes.severityOf(NotificationTypes.RECORDING_READY),
                "녹화 완료", "녹화가 준비되었습니다.", "{}", "RECORDING_READY:les-1",
                "RECORDING_READY:" + me.userId() + ":les-1");

        // Egress webhook 재전송처럼 같은 사건이 두 번 들어오는 경우다. 두 번째는 오류가 아니라 0건이다.
        assertThat(notificationService.create(List.of(same))).isEqualTo(1);
        assertThat(notificationService.create(List.of(same))).isEqualTo(0);

        mockMvc.perform(get("/api/me/notifications").cookie(me.cookies()))
                .andExpect(jsonPath("$.items.length()").value(1));
    }

    @Test
    void severity_comes_from_the_type() throws Exception {
        Account me = loginAs("INSTRUCTOR");
        give(me, NotificationTypes.RECORDING_FAILED, ACTION_REQUIRED, "녹화 실패");
        give(me, NotificationTypes.LIVE_STARTING_SOON, INFO, "곧 시작");
        give(me, NotificationTypes.LESSON_PUBLISHED, INFO, "강의 등록");

        // 기준은 "지나면 늦는가"다 — 실패는 ERROR, 라이브 시각에 걸린 것은 HIGH, 나머지는 NORMAL.
        MvcResult result = mockMvc.perform(get("/api/me/notifications").cookie(me.cookies()))
                .andExpect(status().isOk()).andReturn();
        JsonNode items = json(result).get("items");
        assertThat(severityOfTitle(items, "녹화 실패")).isEqualTo("ERROR");
        assertThat(severityOfTitle(items, "곧 시작")).isEqualTo("HIGH");
        assertThat(severityOfTitle(items, "강의 등록")).isEqualTo("NORMAL");
    }

    @Test
    void the_dedupe_key_is_never_exposed() throws Exception {
        Account me = loginAs("STUDENT");
        give(me, NotificationTypes.VOD_PUBLISHED, INFO, "다시보기");

        // 내부 값이다. 노출하면 다른 사람의 알림 존재를 추측하는 실마리가 된다.
        MvcResult result = mockMvc.perform(get("/api/me/notifications").cookie(me.cookies())).andReturn();
        assertThat(result.getResponse().getContentAsString()).doesNotContain("dedupeKey");
    }

    @Test
    void the_response_carries_no_route_url() throws Exception {
        Account me = loginAs("STUDENT");
        give(me, NotificationTypes.VOD_PUBLISHED, INFO, "다시보기");

        // 목적지는 type + targets + 클릭 시점 상태로 화면이 계산한다. 경로가 바뀌면 쌓인 알림이 깨진다.
        String body = mockMvc.perform(get("/api/me/notifications").cookie(me.cookies()))
                .andReturn().getResponse().getContentAsString();
        assertThat(body).doesNotContain("\"link\"").doesNotContain("\"url\"").doesNotContain("\"screen\"");
    }

    // ---- 헬퍼 ----

    private record Account(UUID userId, Cookie[] cookies) {
    }

    /** 알림 한 건을 만들고 그 id를 돌려준다. */
    private String give(Account account, String type, String actionStatus, String title) throws Exception {
        String dedupeKey = type + ":" + account.userId() + ":" + UUID.randomUUID();
        notificationService.create(List.of(NewNotification.of(
                account.userId(), type, actionStatus, NotificationTypes.severityOf(type),
                title, title + " 설명", "{\"curriculumId\":\"cur-1\"}", type + ":cur-1", dedupeKey)));

        MvcResult result = mockMvc.perform(get("/api/me/notifications").param("size", "50")
                .cookie(account.cookies())).andReturn();
        for (JsonNode item : json(result).get("items")) {
            if (title.equals(item.get("title").asString())) {
                return item.get("notificationId").asString();
            }
        }
        throw new IllegalStateException("방금 만든 알림을 찾지 못했습니다: " + title);
    }

    private void read(Account account, String notificationId) throws Exception {
        write(post("/api/me/notifications/" + notificationId + "/read"), account.cookies(), null)
                .andExpect(status().isOk());
    }

    private String severityOfTitle(JsonNode items, String title) {
        for (JsonNode item : items) {
            if (title.equals(item.get("title").asString())) {
                return item.get("severity").asString();
            }
        }
        throw new IllegalStateException("없는 알림: " + title);
    }

    private org.springframework.test.web.servlet.ResultActions write(
            MockHttpServletRequestBuilder builder, Cookie[] authCookies, String body) throws Exception {
        MvcResult csrf = mockMvc.perform(get("/api/auth/csrf")).andReturn();
        JsonNode csrfBody = json(csrf);
        List<Cookie> cookies = new ArrayList<>();
        cookies.add(csrf.getResponse().getCookie("XSRF-TOKEN"));
        if (authCookies != null) {
            cookies.addAll(List.of(authCookies));
        }
        builder = builder.cookie(cookies.toArray(new Cookie[0]))
                .header(csrfBody.get("headerName").asString(), csrfBody.get("token").asString());
        if (body != null) {
            builder = builder.contentType(MediaType.APPLICATION_JSON).content(body);
        }
        return mockMvc.perform(builder);
    }

    private Account loginAs(String role) throws Exception {
        String email = "notification-" + UUID.randomUUID() + "@liveclass.test";
        write(post("/api/auth/signup"), null, """
                {"email":"%s","password":"password123","displayName":"테스터","role":"%s"}
                """.formatted(email, role)).andExpect(status().isCreated());
        MvcResult login = write(post("/api/auth/login"), null, """
                {"email":"%s","password":"password123"}
                """.formatted(email)).andExpect(status().isOk()).andReturn();
        Cookie[] cookies = login.getResponse().getCookies();
        UUID userId = UUID.fromString(
                json(mockMvc.perform(get("/api/auth/me").cookie(cookies)).andReturn()).get("userId").asString());
        return new Account(userId, cookies);
    }

    private JsonNode json(MvcResult result) throws Exception {
        return jsonMapper.readTree(result.getResponse().getContentAsString());
    }
}
