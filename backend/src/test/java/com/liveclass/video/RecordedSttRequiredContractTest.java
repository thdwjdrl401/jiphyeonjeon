package com.liveclass.video;

import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** ADR-0012의 fail-closed 업로드 게이트: STT가 꺼졌다면 MP4 업로드 전에 거부한다. */
@SpringBootTest(properties = "recorded.stt.enabled=false")
@AutoConfigureMockMvc
@Transactional
class RecordedSttRequiredContractTest {

    @Autowired
    private MockMvc mockMvc;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Test
    void upload_ticket_is_rejected_before_large_upload_when_stt_is_disabled() throws Exception {
        Cookie[] instructor = loginAsInstructor();
        String curriculumId = json(write(post("/api/instructor/curriculums"), instructor,
                "{\"title\":\"STT 필수 테스트\"}").andExpect(status().isCreated()).andReturn())
                .get("curriculumId").asString();
        String sectionId = json(write(post("/api/instructor/curriculums/" + curriculumId + "/sections"),
                instructor, "{\"title\":\"섹션\"}").andExpect(status().isCreated()).andReturn())
                .get("sectionId").asString();
        String lessonId = json(write(post("/api/instructor/sections/" + sectionId + "/recorded-lessons"),
                instructor, "{\"clientRequestId\":\"%s\",\"title\":\"업로드 전 차단\"}"
                        .formatted(UUID.randomUUID()))
                .andExpect(status().isCreated()).andReturn()).get("lessonId").asString();

        write(post("/api/instructor/recorded-lessons/" + lessonId + "/video/upload-requests"),
                instructor,
                "{\"fileName\":\"large.mp4\",\"contentType\":\"video/mp4\",\"fileSize\":104857600}")
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("RECORDED_STT_REQUIRED"));
    }

    /**
     * 같은 사실을 <b>업로드 전에</b> 묻는 길. 강사 화면이 폼을 열 때 읽어 미리 잠근다 —
     * 예전에는 5GiB를 다 채우고 제출한 뒤에야 위 503을 만났고, 그때는 레슨 행이 이미 만들어진
     * 뒤라 영상 없는 강의가 커리큘럼에 남았다.
     */
    @Test
    void capabilities_report_the_closed_caption_switch_before_the_form_is_filled() throws Exception {
        Cookie[] instructor = loginAsInstructor();

        read("/api/instructor/recorded-lessons/capabilities", instructor)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.videoUploadEnabled").value(true))
                .andExpect(jsonPath("$.captionGenerationEnabled").value(false));
    }

    /** 강사 전용 경로다 — 로그인하지 않았으면 스위치 상태도 알려주지 않는다. */
    @Test
    void capabilities_require_an_authenticated_instructor() throws Exception {
        read("/api/instructor/recorded-lessons/capabilities", null)
                .andExpect(status().isUnauthorized());
    }

    private ResultActions read(String path, Cookie[] authCookies) throws Exception {
        MockHttpServletRequestBuilder builder = get(path);
        if (authCookies != null) {
            builder.cookie(authCookies);
        }
        return mockMvc.perform(builder);
    }

    private Cookie[] loginAsInstructor() throws Exception {
        String email = "stt-required-" + UUID.randomUUID() + "@liveclass.test";
        write(post("/api/auth/signup"), null,
                "{\"email\":\"%s\",\"password\":\"password123\",\"displayName\":\"테스터\",\"role\":\"INSTRUCTOR\"}"
                        .formatted(email))
                .andExpect(status().isCreated());
        return write(post("/api/auth/login"), null,
                "{\"email\":\"%s\",\"password\":\"password123\"}".formatted(email))
                .andExpect(status().isOk()).andReturn().getResponse().getCookies();
    }

    private ResultActions write(MockHttpServletRequestBuilder builder, Cookie[] authCookies, String body)
            throws Exception {
        MvcResult csrf = mockMvc.perform(get("/api/auth/csrf")).andReturn();
        JsonNode csrfBody = json(csrf);
        List<Cookie> cookies = new ArrayList<>();
        cookies.add(csrf.getResponse().getCookie("XSRF-TOKEN"));
        if (authCookies != null) {
            cookies.addAll(List.of(authCookies));
        }
        builder.cookie(cookies.toArray(new Cookie[0]))
                .header(csrfBody.get("headerName").asString(), csrfBody.get("token").asString());
        if (body != null) {
            builder.contentType(MediaType.APPLICATION_JSON).content(body);
        }
        return mockMvc.perform(builder);
    }

    private JsonNode json(MvcResult result) throws Exception {
        return jsonMapper.readTree(result.getResponse().getContentAsString());
    }
}
