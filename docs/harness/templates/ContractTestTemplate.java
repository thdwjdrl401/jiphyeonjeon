/*
 * TEMPLATE — 복사해서 채우세요. (docs/ 아래에 있어 컴파일 대상이 아닙니다)
 * 활성화 가이드: docs/harness/ENFORCEMENT.md §C
 * 판단 정책:     docs/harness/POLICY.md
 * 공유 계약:     docs/CONTRACT.md
 *
 * 사용법:
 *   1) 이 파일을 backend/src/test/java/com/liveclass/api/ 아래로 복사하고 이름을 <기능>ContractTest.java 로 변경.
 *   2) @Disabled 를 제거하고 대상 엔드포인트의 상태코드/필드명을 채운다.
 *   3) cd backend && ./gradlew test 로 통과 확인.
 *
 * 이 템플릿은 "FE/BE 공유 계약"만 검증합니다(필드명 camelCase, 상태코드).
 * 내부 로직 단위테스트가 아니라 계약 회귀 방지가 목적입니다.
 */
package com.liveclass.api;

import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@Disabled("TEMPLATE — 복사 후 @Disabled 제거하고 채우세요 (ENFORCEMENT.md §C)")
@SpringBootTest
@AutoConfigureMockMvc
class ContractTestTemplate {

    @Autowired
    private MockMvc mockMvc;

    // 예시 1) 상태코드 계약: 회원가입은 201 (CONTRACT §2)
    @Test
    void signup_returns_201() throws Exception {
        String body = "{"
            + "\"department\":\"부트캠프\",\"position\":\"교육생\","
            + "\"name\":\"홍길동\",\"userId\":\"new-user\",\"password\":\"12345\"}";
        mockMvc.perform(post("/api/v1/users")
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isCreated());
    }

    // 예시 2) 필드명 계약: 방 응답은 camelCase (CONTRACT §1, 최대 함정)
    //   - snake_case 필드(is_active, thumbnail_url, call_start_time)가 응답에 존재하면 실패시킨다.
    // @Test
    // void conference_response_uses_camelCase() throws Exception {
    //     mockMvc.perform(get("/api/v1/conferences/1").header("Authorization", "Bearer " + token))
    //         .andExpect(status().isOk())
    //         .andExpect(jsonPath("$.isActive").exists())
    //         .andExpect(jsonPath("$.thumbnailUrl").exists())
    //         .andExpect(jsonPath("$.callStartTime").exists())
    //         .andExpect(jsonPath("$.is_active").doesNotExist())
    //         .andExpect(jsonPath("$.thumbnail_url").doesNotExist())
    //         .andExpect(jsonPath("$.call_start_time").doesNotExist());
    // }
}
