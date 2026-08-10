package com.liveclass.auth;

import com.liveclass.auth.domain.AppUser;
import com.liveclass.auth.repository.AppUserRepository;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.mail.MailSendException;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.time.OffsetDateTime;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 비밀번호 찾기 계약(FE/BE 공유).
 *
 * <p>지키려는 것은 셋이다.
 *
 * <ol>
 *   <li><b>계정 유무를 흘리지 않는다.</b> 있든 없든 같은 응답이라 이 경로가 가입 확인 도구가 되지 않는다.</li>
 *   <li><b>메일 발송이 실패하면 비밀번호도 바뀌지 않는다.</b> 반쪽만 성공하면 사용자는 예전 것으로도,
 *       받지 못한 임시 비밀번호로도 못 들어간다.</li>
 *   <li><b>임시 비밀번호로 들어오면 바꾸기 전까지 표시가 남는다.</b> 바꾸면 풀린다.</li>
 * </ol>
 */
/*
 * <b>@Transactional을 쓰지 않는다.</b> 이 테스트가 확인하려는 것 중 하나가 "메일이 실패하면
 * 비밀번호도 되돌아간다"인데, 테스트가 트랜잭션을 쥐고 있으면 서비스가 그 트랜잭션에 합류해
 * 요청이 끝나도 되돌아가지 않는다 — 롤백을 볼 수 없다. 대신 만든 계정을 직접 지운다.
 */
@SpringBootTest
@AutoConfigureMockMvc
class PasswordResetContractTest {

    private static final String EMAIL = "reset-target@liveclass.test";
    private static final String ORIGINAL_PASSWORD = "password123";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private AppUserRepository appUserRepository;

    /** 실제 SMTP로 나가면 테스트가 네트워크에 매달린다. 보낸 내용을 여기서 붙잡아 확인한다. */
    @MockitoBean
    private JavaMailSender mailSender;

    @BeforeEach
    void signupTarget() throws Exception {
        removeTarget();
        signup(EMAIL, ORIGINAL_PASSWORD).andExpect(status().isCreated());
    }

    @AfterEach
    void removeTarget() {
        appUserRepository.findByEmail(EMAIL).ifPresent(appUserRepository::delete);
    }

    @Test
    void 임시_비밀번호를_보내도_기존_비밀번호는_그대로_통한다() throws Exception {
        /*
         * 덮어쓰면 남이 내 이메일로 재발급을 누르기만 해도 내가 로그인에서 튕긴다 — 메일함을 못
         * 봐도 남의 계정을 잠글 수 있게 된다. 임시 비밀번호는 열쇠 하나 더일 뿐이다.
         */
        requestReset(EMAIL).andExpect(status().isAccepted());
        String temporary = capturedTemporaryPassword();
        assertThat(temporary).isNotBlank();

        login(EMAIL, ORIGINAL_PASSWORD)
                .andExpect(status().isOk())
                // 원래 비밀번호로 들어온 사람은 바꿀 이유가 없다 — 변경 화면에 가두지 않는다.
                .andExpect(jsonPath("$.signedInWithTemporaryPassword").value(false))
                // 대신 "발급된 게 있다"를 알려 폐기를 물을 수 있게 한다.
                .andExpect(jsonPath("$.temporaryPasswordActive").value(true));

        login(EMAIL, temporary)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.signedInWithTemporaryPassword").value(true));
    }

    @Test
    void 만료된_임시_비밀번호로는_로그인되지_않는다() throws Exception {
        requestReset(EMAIL).andExpect(status().isAccepted());
        String temporary = capturedTemporaryPassword();

        // 만료 시각을 지난 것으로 돌린다 — 만료 검사를 빠뜨리면 30분이 무의미해진다.
        AppUser target = appUserRepository.findByEmail(EMAIL).orElseThrow();
        target.setTemporaryPasswordExpiresAt(OffsetDateTime.now().minusMinutes(1));
        appUserRepository.saveAndFlush(target);

        login(EMAIL, temporary).andExpect(status().isUnauthorized());
        // 기존 비밀번호는 만료와 무관하다.
        login(EMAIL, ORIGINAL_PASSWORD).andExpect(status().isOk());
    }

    @Test
    void 원래_비밀번호로_들어와_임시_비밀번호를_폐기할_수_있다() throws Exception {
        // 내가 요청한 적 없는 재발급을 무르는 길이다.
        requestReset(EMAIL).andExpect(status().isAccepted());
        String temporary = capturedTemporaryPassword();

        MvcResult loggedIn = login(EMAIL, ORIGINAL_PASSWORD).andExpect(status().isOk()).andReturn();
        Cookie session = loggedIn.getResponse().getCookie("SESSION");

        Csrf csrf = fetchCsrf();
        mockMvc.perform(withCsrf(delete("/api/auth/temporary-password"), csrf).cookie(session))
                .andExpect(status().isNoContent());

        login(EMAIL, temporary).andExpect(status().isUnauthorized());
        login(EMAIL, ORIGINAL_PASSWORD).andExpect(status().isOk());
    }

    @Test
    void 없는_계정도_같은_응답이라_가입_여부가_드러나지_않는다() throws Exception {
        requestReset("nobody-here@liveclass.test").andExpect(status().isAccepted());

        // 보낼 곳이 없으므로 메일도 나가지 않는다 — 응답만 같다.
        verifyNoInteractions(mailSender);
    }

    @Test
    void 메일_발송이_실패하면_비밀번호를_바꾸지_않는다() throws Exception {
        doThrow(new MailSendException("smtp down")).when(mailSender).send(any(SimpleMailMessage.class));

        requestReset(EMAIL)
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("MAIL_DELIVERY_FAILED"));

        // 임시 비밀번호가 걸리지 않았다 — 발송 실패인데 열쇠만 늘어나면 안 된다.
        login(EMAIL, ORIGINAL_PASSWORD)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.temporaryPasswordActive").value(false));
    }

    @Test
    void 새_비밀번호를_정하면_임시_비밀번호는_즉시_폐기된다() throws Exception {
        requestReset(EMAIL).andExpect(status().isAccepted());
        String temporary = capturedTemporaryPassword();

        MvcResult loggedIn = login(EMAIL, temporary).andExpect(status().isOk()).andReturn();
        Cookie session = loggedIn.getResponse().getCookie("SESSION");
        assertThat(session).isNotNull();

        Csrf csrf = fetchCsrf();
        // 방금 그 값으로 로그인했으므로 현재 비밀번호를 다시 묻지 않는다.
        mockMvc.perform(withCsrf(put("/api/me/password/temporary"), csrf)
                        .cookie(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"newPassword":"brand-new-password"}
                                """))
                .andExpect(status().isNoContent());

        // 메일에 남은 값이 계속 통하면 30분 만료를 둔 뜻이 없다.
        login(EMAIL, temporary).andExpect(status().isUnauthorized());
        login(EMAIL, "brand-new-password")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.signedInWithTemporaryPassword").value(false))
                .andExpect(jsonPath("$.temporaryPasswordActive").value(false));
    }

    /** 발송된 본문에서 임시 비밀번호를 되찾는다. 본문 형식이 바뀌면 여기서 먼저 드러난다. */
    private String capturedTemporaryPassword() {
        ArgumentCaptor<SimpleMailMessage> captor = ArgumentCaptor.forClass(SimpleMailMessage.class);
        verify(mailSender).send(captor.capture());
        SimpleMailMessage sent = captor.getValue();
        assertThat(sent.getTo()).containsExactly(EMAIL);

        Matcher matcher = Pattern.compile("(?m)^\\s{2,}([A-Za-z0-9]{8,})\\s*$")
                .matcher(String.valueOf(sent.getText()));
        assertThat(matcher.find()).as("본문에서 임시 비밀번호를 찾지 못했다").isTrue();
        return matcher.group(1);
    }

    private ResultActions requestReset(String email) throws Exception {
        Csrf csrf = fetchCsrf();
        return mockMvc.perform(withCsrf(post("/api/auth/password-reset"), csrf)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"email":"%s"}
                        """.formatted(email)));
    }

    private ResultActions signup(String email, String password) throws Exception {
        Csrf csrf = fetchCsrf();
        return mockMvc.perform(withCsrf(post("/api/auth/signup"), csrf)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"email":"%s","password":"%s","displayName":"김학생","role":"STUDENT"}
                        """.formatted(email, password)));
    }

    private ResultActions login(String email, String password) throws Exception {
        Csrf csrf = fetchCsrf();
        return mockMvc.perform(withCsrf(post("/api/auth/login"), csrf)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"email":"%s","password":"%s"}
                        """.formatted(email, password)));
    }

    private MockHttpServletRequestBuilder withCsrf(MockHttpServletRequestBuilder builder, Csrf csrf) {
        return builder.cookie(csrf.cookie()).header(csrf.headerName(), csrf.token());
    }

    /** 프론트가 실제로 하는 핸드셰이크를 그대로 재현한다(AuthContractTest와 같은 이유). */
    private Csrf fetchCsrf() throws Exception {
        MvcResult result = mockMvc.perform(get("/api/auth/csrf")).andExpect(status().isOk()).andReturn();
        Cookie cookie = result.getResponse().getCookie("XSRF-TOKEN");
        assertThat(cookie).isNotNull();
        String body = result.getResponse().getContentAsString();
        return new Csrf(cookie, readJson(body, "headerName"), readJson(body, "token"));
    }

    private static String readJson(String body, String field) {
        Matcher matcher = Pattern.compile("\"" + field + "\"\\s*:\\s*\"([^\"]+)\"").matcher(body);
        assertThat(matcher.find()).isTrue();
        return matcher.group(1);
    }

    private record Csrf(Cookie cookie, String headerName, String token) {
    }
}
