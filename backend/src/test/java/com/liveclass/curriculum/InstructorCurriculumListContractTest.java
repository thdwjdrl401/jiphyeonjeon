package com.liveclass.curriculum;

import com.liveclass.live.api.LiveRecordingControl;
import com.liveclass.live.service.AgentDispatchControl;
import com.liveclass.live.service.LiveRoomControl;
import com.liveclass.live.service.LiveStartOrchestrator;
import com.liveclass.support.LiveStartTestSupport;
import jakarta.persistence.EntityManager;
import jakarta.servlet.http.Cookie;
import org.hibernate.SessionFactory;
import org.hibernate.stat.Statistics;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 강사 운영 목록 계약 검증 (MY-CURRICULUM-02: 페이지 봉투·검색·필터·정렬·다음 일정).
 *
 * <p>이 계약이 테스트를 요구하는 이유(POLICY): FE 대시보드가 소비하는 실제 JSON 필드명·페이지 봉투와
 * 소유권 경계가 걸려 있고, nextLiveSession은 모듈(live·lesson)을 가로질러 조립되므로 회귀가 조용히 난다.
 *
 * <p>범위 밖(의도적 미구현)도 계약으로 못박는다 — materialAttentionCount·allowedActions는 응답에
 * 없어야 하고, sort=NEXT_SESSION은 400이어야 한다(조용히 틀린 정렬 대신).
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class InstructorCurriculumListContractTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private EntityManager entityManager;

    @Autowired
    private LiveStartOrchestrator startOrchestrator;

    // 라이브 시작·종료가 실제 LiveKit/Egress를 안 타게 목으로 둔다.
    @MockitoBean
    private LiveRoomControl roomControl;

    @MockitoBean
    private LiveRecordingControl recordingControl;

    @MockitoBean
    private AgentDispatchControl agentDispatchControl;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    // ---- 응답 shape ----

    @Test
    void list_returns_page_envelope_with_contract_item_shape() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        createCurriculum(auth, "실시간 Spring 입문");
        syncWithDatabase();

        list(auth)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.size").value(20))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.totalPages").value(1))
                .andExpect(jsonPath("$.hasNext").value(false))
                .andExpect(jsonPath("$.items[0].curriculumId").exists())
                .andExpect(jsonPath("$.items[0].title").value("실시간 Spring 입문"))
                .andExpect(jsonPath("$.items[0].lifecycleStatus").value("DRAFT"))
                .andExpect(jsonPath("$.items[0].sectionCount").value(0))
                .andExpect(jsonPath("$.items[0].lessonCount").value(0))
                .andExpect(jsonPath("$.items[0].publishedLessonCount").value(0))
                .andExpect(jsonPath("$.items[0].nextLiveSession").doesNotExist())
                // 범위 밖 필드는 가짜 값으로라도 내려가면 안 된다.
                .andExpect(jsonPath("$.items[0].materialAttentionCount").doesNotExist())
                .andExpect(jsonPath("$.items[0].allowedActions").doesNotExist())
                .andExpect(jsonPath("$.items[0].curriculum_id").doesNotExist());
    }

    // ---- 페이지네이션·소유권 ----

    @Test
    void paging_splits_results_and_reports_has_next() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        createCurriculum(auth, "A 커리큘럼");
        createCurriculum(auth, "B 커리큘럼");
        createCurriculum(auth, "C 커리큘럼");
        syncWithDatabase();

        list(auth, "size", "2")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(2))
                .andExpect(jsonPath("$.size").value(2))
                .andExpect(jsonPath("$.totalElements").value(3))
                .andExpect(jsonPath("$.totalPages").value(2))
                .andExpect(jsonPath("$.hasNext").value(true));

        list(auth, "size", "2", "page", "1")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.page").value(1))
                .andExpect(jsonPath("$.hasNext").value(false));
    }

    @Test
    void only_my_curriculums_are_listed() throws Exception {
        Cookie[] mine = loginAs("INSTRUCTOR");
        createCurriculum(mine, "내 커리큘럼");

        Cookie[] other = loginAs("INSTRUCTOR");
        createCurriculum(other, "남의 커리큘럼");
        syncWithDatabase();

        list(mine)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.items[0].title").value("내 커리큘럼"));

        list(other)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.items[0].title").value("남의 커리큘럼"));
    }

    @Test
    void out_of_range_page_returns_empty_page_not_500() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        createCurriculum(auth, "한 개");
        syncWithDatabase();

        // PageParams가 page 상한을 잘라 offset이 int를 넘지 않게 한다 — 빈 목록이지 500이 아니다.
        list(auth, "page", "2147483647")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(0))
                .andExpect(jsonPath("$.totalElements").value(1));
    }

    // ---- 검색·필터·정렬 ----

    @Test
    void q_matches_title_case_insensitively() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        createCurriculum(auth, "Spring 심화");
        createCurriculum(auth, "React 기초");
        syncWithDatabase();

        list(auth, "q", "spring")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.items[0].title").value("Spring 심화"));
    }

    @Test
    void status_filters_by_lifecycle() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String published = createCurriculum(auth, "공개될 것");
        createCurriculum(auth, "초안인 것");
        publish(auth, published);
        syncWithDatabase();

        list(auth, "status", "PUBLISHED")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.items[0].title").value("공개될 것"));

        list(auth, "status", "DRAFT")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.items[0].title").value("초안인 것"));
    }

    /** q·status를 함께 준 조합(파생 파인더 4갈래 중 마지막 분기)은 AND로 좁혀져야 한다. */
    @Test
    void q_and_status_narrow_together() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String target = createCurriculum(auth, "Spring 발행본");     // q·status 둘 다 맞는 유일한 행
        String otherTopic = createCurriculum(auth, "React 발행본");  // status만 맞음
        createCurriculum(auth, "Spring 초안");                       // q만 맞음
        publish(auth, target);
        publish(auth, otherTopic);
        syncWithDatabase();

        list(auth, "q", "spring", "status", "PUBLISHED")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.items[0].curriculumId").value(target));
    }

    /** 필터가 걸려도 소유자 경계가 먼저다 — 제목·상태가 똑같은 남의 커리큘럼이 새어 들어오면 안 된다. */
    @Test
    void other_instructors_curriculum_never_leaks_through_filters() throws Exception {
        Cookie[] mine = loginAs("INSTRUCTOR");
        String myCurriculumId = createCurriculum(mine, "Spring 완전정복");
        publish(mine, myCurriculumId);

        Cookie[] other = loginAs("INSTRUCTOR");
        publish(other, createCurriculum(other, "Spring 완전정복"));   // 제목·상태까지 동일
        syncWithDatabase();

        for (String[] params : List.of(
                new String[]{"q", "spring"},
                new String[]{"status", "PUBLISHED"},
                new String[]{"q", "spring", "status", "PUBLISHED"})) {
            list(mine, params)
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.totalElements").value(1))
                    .andExpect(jsonPath("$.items[0].curriculumId").value(myCurriculumId));
        }
    }

    @Test
    void sort_title_asc_orders_by_title() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        createCurriculum(auth, "Zeta");
        createCurriculum(auth, "Alpha");
        syncWithDatabase();

        list(auth, "sort", "TITLE_ASC")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].title").value("Alpha"))
                .andExpect(jsonPath("$.items[1].title").value("Zeta"));
    }

    @Test
    void default_sort_is_latest_first() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        createCurriculum(auth, "먼저 만든 것");
        createCurriculum(auth, "나중에 만든 것");
        syncWithDatabase();

        list(auth)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].title").value("나중에 만든 것"))
                .andExpect(jsonPath("$.items[1].title").value("먼저 만든 것"));
    }

    @Test
    void unsupported_next_session_sort_returns_400() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");

        // 커리큘럼×라이브를 가로지르는 정렬은 미구현 — 조용히 틀리게 정렬하는 대신 거절한다.
        list(auth, "sort", "NEXT_SESSION")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
    }

    // ---- 다음 일정(nextLiveSession) ----

    @Test
    void next_live_session_is_the_earliest_upcoming_one() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(auth, "일정 있는 커리큘럼");
        String sectionId = createSection(auth, curriculumId, "1주차");

        // 늦은 일정을 먼저 만들어 "생성 순서"가 아니라 "가장 이른 일정"이 뽑히는지 본다.
        createLiveSession(auth, createLesson(auth, sectionId, "나중 레슨"), daysLater(30));
        String earlyLessonId = createLesson(auth, sectionId, "가장 빠른 레슨");
        String earlySessionId = createLiveSession(auth, earlyLessonId, daysLater(1));
        syncWithDatabase();

        list(auth)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].nextLiveSession.sessionId").value(earlySessionId))
                .andExpect(jsonPath("$.items[0].nextLiveSession.lessonId").value(earlyLessonId))
                .andExpect(jsonPath("$.items[0].nextLiveSession.lessonTitle").value("가장 빠른 레슨"))
                .andExpect(jsonPath("$.items[0].nextLiveSession.liveSessionStatus").value("SCHEDULED"))
                .andExpect(jsonPath("$.items[0].nextLiveSession.scheduledAt").exists());
    }

    @Test
    void next_live_session_is_null_when_only_session_has_no_schedule() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(auth, "일정 미정");
        String sectionId = createSection(auth, curriculumId, "1주차");
        // scheduledAt 없이 만들면 DRAFT — 아직 "다음 일정"이 아니다.
        createLiveSession(auth, createLesson(auth, sectionId, "레슨"), null);
        syncWithDatabase();

        list(auth)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].nextLiveSession").doesNotExist());
    }

    @Test
    void next_live_session_is_null_when_only_session_cancelled() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(auth, "취소된 일정");
        String sectionId = createSection(auth, curriculumId, "1주차");
        String sessionId = createLiveSession(auth, createLesson(auth, sectionId, "레슨"), daysLater(1));
        write(post("/api/instructor/live-sessions/" + sessionId + "/cancel"), auth, null)
                .andExpect(status().isOk());
        syncWithDatabase();

        list(auth)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].nextLiveSession").doesNotExist());
    }

    @Test
    void next_live_session_is_null_when_only_session_ended() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(auth, "끝난 일정");
        String sectionId = createSection(auth, curriculumId, "1주차");
        String sessionId = createLiveSession(auth, createLesson(auth, sectionId, "레슨"), daysLater(1));
        goLive(auth, sessionId);
        write(post("/api/live-sessions/" + sessionId + "/end"), auth, null).andExpect(status().isOk());
        syncWithDatabase();

        list(auth)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].nextLiveSession").doesNotExist());
    }

    /**
     * 커리큘럼 ↔ 세션 짝짓기. 배치 조회 결과를 커리큘럼별로 다시 나눠 담는 과정에서 매핑이 어긋나도
     * "세션이 하나뿐인" 테스트는 전부 통과해버린다. 서로 다른 커리큘럼 두 개에 각자의 세션을 두고
     * <b>각 카드가 자기 세션을 들고 있는지</b>를 curriculumId 기준으로 확인한다.
     */
    @Test
    void each_card_carries_its_own_curriculums_session() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");

        String firstId = createCurriculum(auth, "첫 커리큘럼");
        String firstLessonId = createLesson(auth, createSection(auth, firstId, "1주차"), "첫 레슨");
        String firstSessionId = createLiveSession(auth, firstLessonId, daysLater(1));

        String secondId = createCurriculum(auth, "둘째 커리큘럼");
        String secondLessonId = createLesson(auth, createSection(auth, secondId, "1주차"), "둘째 레슨");
        String secondSessionId = createLiveSession(auth, secondLessonId, daysLater(2));
        syncWithDatabase();

        JsonNode body = json(list(auth).andExpect(status().isOk()).andReturn());

        JsonNode first = itemOf(body, firstId).get("nextLiveSession");
        assertThat(first.get("sessionId").asString()).isEqualTo(firstSessionId);
        assertThat(first.get("lessonId").asString()).isEqualTo(firstLessonId);
        assertThat(first.get("lessonTitle").asString()).isEqualTo("첫 레슨");

        JsonNode second = itemOf(body, secondId).get("nextLiveSession");
        assertThat(second.get("sessionId").asString()).isEqualTo(secondSessionId);
        assertThat(second.get("lessonId").asString()).isEqualTo(secondLessonId);
        assertThat(second.get("lessonTitle").asString()).isEqualTo("둘째 레슨");
    }

    /**
     * 시작하지 않은 채 지나가버린 일정은 "다음 일정"이 아니다. 세션에는 에셋 같은 회수 배치가 없어
     * 방치된 SCHEDULED 행이 DB에 영원히 남으므로, 조회 조건에서 걸러내지 않으면 시간이 갈수록 나빠진다.
     */
    @Test
    void next_live_session_is_null_when_only_session_is_past_and_never_started() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(auth, "지나간 일정");
        String sectionId = createSection(auth, curriculumId, "1주차");
        // 어제 예정이었지만 시작도 취소도 안 한 세션 — 상태는 그대로 SCHEDULED다.
        createLiveSession(auth, createLesson(auth, sectionId, "레슨"), daysLater(-1));
        syncWithDatabase();

        list(auth)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].nextLiveSession").doesNotExist());
    }

    /** 방치된 과거 일정이 진짜 다음 일정을 가리면 안 된다(가장 이른 행이 과거 세션이 되는 함정). */
    @Test
    void stale_past_session_does_not_mask_the_real_upcoming_one() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(auth, "과거와 미래가 섞인 커리큘럼");
        String sectionId = createSection(auth, curriculumId, "1주차");

        createLiveSession(auth, createLesson(auth, sectionId, "지나간 레슨"), daysLater(-30));
        String upcomingLessonId = createLesson(auth, sectionId, "다가올 레슨");
        String upcomingSessionId = createLiveSession(auth, upcomingLessonId, daysLater(3));
        syncWithDatabase();

        list(auth)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].nextLiveSession.sessionId").value(upcomingSessionId))
                .andExpect(jsonPath("$.items[0].nextLiveSession.lessonTitle").value("다가올 레슨"));
    }

    /** 10분 전에 시작해 지금 방송 중인 세션은 scheduledAt이 과거여도 계속 "지금/다음 일정"이다. */
    @Test
    void running_session_is_still_the_next_one_though_scheduled_in_the_past() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(auth, "진행 중인 커리큘럼");
        String sectionId = createSection(auth, curriculumId, "1주차");
        String sessionId = createLiveSession(auth, createLesson(auth, sectionId, "진행 중 레슨"),
                OffsetDateTime.now().minusMinutes(10));
        goLive(auth, sessionId);
        syncWithDatabase();

        list(auth)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].nextLiveSession.sessionId").value(sessionId))
                .andExpect(jsonPath("$.items[0].nextLiveSession.liveSessionStatus").value("LIVE"));
    }

    /**
     * N+1 회귀 방지. 부가정보(썸네일·다음 세션·레슨 제목)를 행마다 조회하면 커리큘럼이 늘수록
     * 쿼리도 늘어난다. 행 수만 1 → 3으로 늘렸을 때 <b>SQL 문 수가 그대로</b>인지로 배치를 증명한다.
     */
    @Test
    void list_query_count_does_not_grow_with_row_count() throws Exception {
        Statistics stats = entityManager.getEntityManagerFactory()
                .unwrap(SessionFactory.class).getStatistics();
        boolean wasEnabled = stats.isStatisticsEnabled();
        stats.setStatisticsEnabled(true);
        try {
            Cookie[] auth = loginAs("INSTRUCTOR");
            createCurriculumWithScheduledSession(auth, "하나", daysLater(1));
            syncWithDatabase();

            long before = stats.getPrepareStatementCount();
            list(auth).andExpect(status().isOk()).andExpect(jsonPath("$.totalElements").value(1));
            long oneRow = stats.getPrepareStatementCount() - before;

            createCurriculumWithScheduledSession(auth, "둘", daysLater(2));
            createCurriculumWithScheduledSession(auth, "셋", daysLater(3));
            syncWithDatabase();

            before = stats.getPrepareStatementCount();
            list(auth)
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.totalElements").value(3))
                    .andExpect(jsonPath("$.items[0].nextLiveSession.lessonTitle").exists())
                    .andExpect(jsonPath("$.items[1].nextLiveSession.lessonTitle").exists())
                    .andExpect(jsonPath("$.items[2].nextLiveSession.lessonTitle").exists());
            long threeRows = stats.getPrepareStatementCount() - before;

            // 통계가 실제로 세고 있는지부터 확인한다(0이면 아래 동치 비교가 무의미해진다).
            // 현재 3문: 목록 1 + 다음 세션 배치 1 + 레슨 제목 배치 1 (0페이지가 다 차지 않으면 count 쿼리는 생략된다).
            assertThat(oneRow).as("목록 조회가 SQL을 발행하긴 해야 한다").isBetween(1L, 8L);
            assertThat(threeRows)
                    .as("행이 3배가 돼도 쿼리 수는 그대로여야 한다(배치 조회). 1행=%d, 3행=%d", oneRow, threeRows)
                    .isEqualTo(oneRow);
        } finally {
            stats.setStatisticsEnabled(wasEnabled);
        }
    }

    // ---- 헬퍼 ----

    private void createCurriculumWithScheduledSession(Cookie[] auth, String title, OffsetDateTime scheduledAt)
            throws Exception {
        String curriculumId = createCurriculum(auth, title);
        String sectionId = createSection(auth, curriculumId, title + " 섹션");
        createLiveSession(auth, createLesson(auth, sectionId, title + " 레슨"), scheduledAt);
    }

    /**
     * 기준 시각을 지금으로부터의 상대값으로 잡는다. 고정 날짜를 박으면 그 날이 지나는 순간
     * "미래 일정" 테스트가 조용히 "과거 일정" 테스트로 바뀌어 버린다(음수면 과거).
     */
    private OffsetDateTime daysLater(int days) {
        return OffsetDateTime.now().plusDays(days);
    }

    /** 응답 items에서 특정 커리큘럼의 카드를 찾는다 — 순서가 아니라 curriculumId로 짝을 확인하기 위해. */
    private JsonNode itemOf(JsonNode body, String curriculumId) {
        JsonNode items = body.get("items");
        for (int i = 0; i < items.size(); i++) {
            if (curriculumId.equals(items.get(i).get("curriculumId").asString())) {
                return items.get(i);
            }
        }
        throw new AssertionError("목록에 없는 커리큘럼: " + curriculumId);
    }

    /** 카운터는 DB 트리거가 유지하므로 flush(트리거 발화) + clear(캐시 비움) 후에 조회해야 실제 값이 보인다. */
    private void syncWithDatabase() {
        entityManager.flush();
        entityManager.clear();
    }

    private ResultActions list(Cookie[] auth, String... params) throws Exception {
        MockHttpServletRequestBuilder builder = get("/api/instructor/curriculums").cookie(auth);
        for (int i = 0; i < params.length; i += 2) {
            builder = builder.param(params[i], params[i + 1]);
        }
        return mockMvc.perform(builder);
    }

    private String createCurriculum(Cookie[] auth, String title) throws Exception {
        MvcResult result = write(post("/api/instructor/curriculums"), auth,
                "{\"title\":\"" + title + "\"}")
                .andExpect(status().isCreated())
                .andReturn();
        return json(result).get("curriculumId").asString();
    }

    private String createSection(Cookie[] auth, String curriculumId, String title) throws Exception {
        MvcResult result = write(post("/api/instructor/curriculums/" + curriculumId + "/sections"), auth,
                "{\"title\":\"" + title + "\"}")
                .andExpect(status().isCreated())
                .andReturn();
        return json(result).get("sectionId").asString();
    }

    private String createLesson(Cookie[] auth, String sectionId, String title) throws Exception {
        MvcResult result = write(post("/api/instructor/sections/" + sectionId + "/lessons"), auth,
                "{\"title\":\"" + title + "\"}")
                .andExpect(status().isCreated())
                .andReturn();
        return json(result).get("lessonId").asString();
    }

    private void publish(Cookie[] auth, String curriculumId) throws Exception {
        write(post("/api/instructor/curriculums/" + curriculumId + "/publish"), auth, null)
                .andExpect(status().isOk());
    }

    /**
     * scheduledAt이 null이면 일정 없는 DRAFT 세션이 만들어진다.
     *
     * <p>과거 일정도 이 엔드포인트로 그대로 심는다 — 생성 API는 미래 시각을 강제하지 않고
     * scheduledAt이 있으면 SCHEDULED로 만들기 때문에, "지나갔는데 시작도 취소도 안 된 세션"이
     * JdbcTemplate으로 컬럼을 덮어쓰지 않고도 API만으로 정확히 재현된다.
     */
    /** /start는 202만 돌려주므로 시작 게이트를 동기로 돌려 LIVE까지 올린다(운영에서는 커밋 후 비동기). */
    private void goLive(Cookie[] auth, String sessionId) throws Exception {
        String instructorId = json(mockMvc.perform(get("/api/auth/me").cookie(auth)).andReturn())
                .get("userId").asString();
        LiveStartTestSupport.stubInstructorPublishing(roomControl, sessionId, instructorId);
        LiveStartTestSupport.stubRecordingReady(recordingControl);
        LiveStartTestSupport.stubAgentDispatched(agentDispatchControl);
        write(post("/api/live-sessions/" + sessionId + "/start"), auth, null).andExpect(status().isAccepted());
        startOrchestrator.runStartGates(UUID.fromString(sessionId));
    }

    private String createLiveSession(Cookie[] auth, String lessonId, OffsetDateTime scheduledAt) throws Exception {
        String body = scheduledAt == null ? null : "{\"scheduledAt\":\"" + scheduledAt + "\"}";
        MvcResult result = write(post("/api/instructor/lessons/" + lessonId + "/live-sessions"), auth, body)
                .andExpect(status().isCreated())
                .andReturn();
        return json(result).get("sessionId").asString();
    }

    /** 변경 요청: CSRF 핸드셰이크(쿠키+헤더) + 로그인 세션 쿠키를 함께 실어 보낸다. */
    private ResultActions write(MockHttpServletRequestBuilder builder, Cookie[] authCookies, String body)
            throws Exception {
        MvcResult csrf = mockMvc.perform(get("/api/auth/csrf")).andReturn();
        JsonNode csrfBody = json(csrf);
        Cookie xsrf = csrf.getResponse().getCookie("XSRF-TOKEN");

        List<Cookie> cookies = new ArrayList<>();
        cookies.add(xsrf);
        if (authCookies != null) {
            cookies.addAll(List.of(authCookies));
        }

        builder = builder
                .cookie(cookies.toArray(new Cookie[0]))
                .header(csrfBody.get("headerName").asString(), csrfBody.get("token").asString());
        if (body != null) {
            builder = builder.contentType(MediaType.APPLICATION_JSON).content(body);
        }
        return mockMvc.perform(builder);
    }

    private Cookie[] loginAs(String role) throws Exception {
        String email = "list-" + UUID.randomUUID() + "@liveclass.test";

        write(post("/api/auth/signup"), null, """
                {"email":"%s","password":"password123","displayName":"테스터","role":"%s"}
                """.formatted(email, role))
                .andExpect(status().isCreated());

        MvcResult login = write(post("/api/auth/login"), null, """
                {"email":"%s","password":"password123"}
                """.formatted(email))
                .andExpect(status().isOk())
                .andReturn();

        return login.getResponse().getCookies();
    }

    private JsonNode json(MvcResult result) throws Exception {
        return jsonMapper.readTree(result.getResponse().getContentAsString());
    }
}
