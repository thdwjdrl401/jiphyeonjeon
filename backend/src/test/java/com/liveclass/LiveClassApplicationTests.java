package com.liveclass;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * 컨텍스트 로드 스모크. 전체 컨텍스트를 띄우므로 Postgres/Redis가 필요하지만,
 * {@code com.liveclass.support.TestcontainersConfiguration}이 모든 {@code @SpringBootTest}에
 * 자동 주입하는 랜덤 포트 컨테이너가 붙는다(ADR-0038) — 로컬 compose 인프라를 띄우지 않아도
 * {@code ./gradlew test}가 통과한다.
 */
@SpringBootTest
class LiveClassApplicationTests {

    @Test
    void contextLoads() {
    }
}
