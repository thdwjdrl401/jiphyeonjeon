package com.liveclass.learning;

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

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 강의 용어집 계약(ADR-0064).
 *
 * <p>지키려는 것은 <b>두 겹이 합쳐지는 방식</b>이다. AI가 자료에서 뽑은 것이 베이스이고 강사 수정본이
 * 덮어쓴다. 강사 쪽에만 있는 용어는 추가된 것이다.
 *
 * <p>ai 원본은 이 테스트에서 채우지 않는다 — 남의 스키마라 쓰지 않는 것이 계약이고(읽기 전용),
 * AI 추출도 기본 꺼짐이다. 여기서는 <b>강사 수정 경로</b>와 합치기 규칙을 고정한다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class LessonGlossaryContractTest {

    @Autowired
    private MockMvc mockMvc;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Test
    void an_empty_glossary_is_an_empty_list_not_an_error() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String lessonId = createLesson(instructor);

        // 자료를 안 올렸거나 AI 추출이 꺼져 있으면 비어 있다. 그건 오류가 아니다.
        mockMvc.perform(get("/api/lessons/" + lessonId + "/glossary").cookie(instructor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void an_instructor_can_add_a_term() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String lessonId = createLesson(instructor);

        // ai 원본에 없는 용어를 넣으면 그것이 곧 추가다 — 추가용 표를 따로 두지 않는다.
        write(put("/api/instructor/lessons/" + lessonId + "/glossary"), instructor,
                "{\"term\":\"SecurityContext\",\"definition\":\"인증 정보를 담는 컨테이너\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.source").value("INSTRUCTOR"));

        mockMvc.perform(get("/api/lessons/" + lessonId + "/glossary").cookie(instructor))
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].termId").value("SecurityContext"))
                .andExpect(jsonPath("$[0].definition").value("인증 정보를 담는 컨테이너"));
    }

    @Test
    void writing_the_same_term_again_overwrites_it() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String lessonId = createLesson(instructor);

        write(put("/api/instructor/lessons/" + lessonId + "/glossary"), instructor,
                "{\"term\":\"필터 체인\",\"definition\":\"첫 설명\"}").andExpect(status().isOk());
        write(put("/api/instructor/lessons/" + lessonId + "/glossary"), instructor,
                "{\"term\":\"필터 체인\",\"definition\":\"고친 설명\"}").andExpect(status().isOk());

        // 같은 용어가 두 줄이 되면 자막에 링크가 두 번 걸린다.
        mockMvc.perform(get("/api/lessons/" + lessonId + "/glossary").cookie(instructor))
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].definition").value("고친 설명"));
    }

    @Test
    void the_term_id_is_the_term_itself() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String lessonId = createLesson(instructor);

        write(put("/api/instructor/lessons/" + lessonId + "/glossary"), instructor,
                "{\"term\":\"  SecurityContext  \",\"definition\":\"설명\"}").andExpect(status().isOk());

        // 화면이 자막에서 찾을 때 쓰는 문자열과 같아야 한다. 앞뒤 공백은 다듬는다.
        mockMvc.perform(get("/api/lessons/" + lessonId + "/glossary").cookie(instructor))
                .andExpect(jsonPath("$[0].termId").value("SecurityContext"))
                .andExpect(jsonPath("$[0].term").value("SecurityContext"));
    }

    @Test
    void a_blank_term_is_rejected() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String lessonId = createLesson(instructor);

        write(put("/api/instructor/lessons/" + lessonId + "/glossary"), instructor,
                "{\"term\":\"   \",\"definition\":\"설명\"}")
                .andExpect(status().isBadRequest());
    }

    @Test
    void an_outsider_cannot_read_or_write_the_glossary() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String lessonId = createLesson(instructor);

        Cookie[] outsider = loginAs("STUDENT");
        mockMvc.perform(get("/api/lessons/" + lessonId + "/glossary").cookie(outsider))
                .andExpect(status().isForbidden());
        // 쓰기는 강사 경로라 역할 게이트에서 먼저 막힌다.
        write(put("/api/instructor/lessons/" + lessonId + "/glossary"), outsider,
                "{\"term\":\"x\",\"definition\":\"y\"}")
                .andExpect(status().isForbidden());
    }

    // ---- 헬퍼 ----

    private String createLesson(Cookie[] instructor) throws Exception {
        String cid = json(write(post("/api/instructor/curriculums"), instructor, "{\"title\":\"용어집 테스트\"}")
                .andReturn()).get("curriculumId").asString();
        String sid = json(write(post("/api/instructor/curriculums/" + cid + "/sections"), instructor, "{\"title\":\"섹션\"}")
                .andReturn()).get("sectionId").asString();
        return json(write(post("/api/instructor/sections/" + sid + "/lessons"), instructor, "{\"title\":\"레슨\"}")
                .andReturn()).get("lessonId").asString();
    }

    private org.springframework.test.web.servlet.ResultActions write(
            MockHttpServletRequestBuilder builder, Cookie[] authCookies, String body) throws Exception {
        MvcResult csrf = mockMvc.perform(get("/api/auth/csrf")).andReturn();
        JsonNode csrfBody = json(csrf);
        Cookie xsrf = csrf.getResponse().getCookie("XSRF-TOKEN");
        List<Cookie> cookies = new ArrayList<>();
        cookies.add(xsrf);
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

    /**
     * 지우는 것은 <b>원본을 지우는 것이 아니다.</b> ai 원본은 자료를 다시 읽을 때마다 되살아나므로,
     * 지웠다는 사실을 덮어쓰기 자리에 남겨야 한다. 여기서는 그 결과(목록에서 빠진다)를 본다.
     */
    @Test
    void an_instructor_can_delete_a_term() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String lessonId = createLesson(instructor);
        write(put("/api/instructor/lessons/" + lessonId + "/glossary"), instructor,
                "{\"term\":\"필터 체인\",\"definition\":\"설명\"}").andExpect(status().isOk());

        write(delete("/api/instructor/lessons/" + lessonId + "/glossary/필터 체인"), instructor, null)
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/api/lessons/" + lessonId + "/glossary").cookie(instructor))
                .andExpect(jsonPath("$.length()").value(0));
    }

    /** 없는 용어를 지워도, 두 번 지워도 같다 — 목록을 여러 탭에서 보다 두 번 눌러도 실패하지 않는다. */
    @Test
    void deleting_is_idempotent() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String lessonId = createLesson(instructor);

        write(delete("/api/instructor/lessons/" + lessonId + "/glossary/없던 용어"), instructor, null)
                .andExpect(status().isNoContent());
        write(delete("/api/instructor/lessons/" + lessonId + "/glossary/없던 용어"), instructor, null)
                .andExpect(status().isNoContent());
    }

    /** 지운 용어를 다시 등록하면 되살아난다. 묘비가 남아 계속 안 보이면 지운 것을 되돌릴 수 없다. */
    @Test
    void re_adding_a_deleted_term_brings_it_back() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String lessonId = createLesson(instructor);
        write(put("/api/instructor/lessons/" + lessonId + "/glossary"), instructor,
                "{\"term\":\"세션\",\"definition\":\"첫 설명\"}").andExpect(status().isOk());
        write(delete("/api/instructor/lessons/" + lessonId + "/glossary/세션"), instructor, null)
                .andExpect(status().isNoContent());

        write(put("/api/instructor/lessons/" + lessonId + "/glossary"), instructor,
                "{\"term\":\"세션\",\"definition\":\"다시 쓴 설명\"}").andExpect(status().isOk());

        mockMvc.perform(get("/api/lessons/" + lessonId + "/glossary").cookie(instructor))
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].definition").value("다시 쓴 설명"));
    }

    private Cookie[] loginAs(String role) throws Exception {
        String email = "glossary-" + UUID.randomUUID() + "@liveclass.test";
        write(post("/api/auth/signup"), null, """
                {"email":"%s","password":"password123","displayName":"테스터","role":"%s"}
                """.formatted(email, role)).andExpect(status().isCreated());
        MvcResult login = write(post("/api/auth/login"), null, """
                {"email":"%s","password":"password123"}
                """.formatted(email)).andExpect(status().isOk()).andReturn();
        return login.getResponse().getCookies();
    }

    private JsonNode json(MvcResult result) throws Exception {
        return jsonMapper.readTree(result.getResponse().getContentAsString());
    }
}
