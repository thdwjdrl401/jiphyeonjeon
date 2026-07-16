package com.liveclass;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * 컨텍스트 로드 스모크. 전체 컨텍스트를 띄우므로 Postgres/Redis가 필요하다
 * (docker compose up 상태에서 실행). CI 격리는 이후 Testcontainers로.
 */
@SpringBootTest
class LiveClassApplicationTests {

    @Test
    void contextLoads() {
    }
}
