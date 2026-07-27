package com.liveclass.support;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.SQLException;
import javax.sql.DataSource;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;

/**
 * Testcontainers 격리 증명(ADR-0038).
 *
 * <p>{@code @ServiceConnection} 팩토리가 없거나 매칭에 실패하면 스프링은 application.yml의
 * localhost 기본값(datasource 5432·redis 6379)으로 조용히 폴백할 수 있다 — 그 상태에서도 로컬
 * compose 인프라(liveclass-postgres/liveclass-redis)가 떠 있으면 테스트는 전부 초록이 된다.
 * 즉 "테스트가 통과한다"는 사실만으로는 격리를 증명하지 못한다.
 *
 * <p>이 테스트는 스프링이 실제로 주입한 datasource/redis 접속 정보의 포트를 읽어, 고정 포트
 * (5432/6379)가 아니라 {@link TestcontainersConfiguration}이 띄운 컨테이너의 실제 매핑 포트와
 * 정확히 일치하는지 단언한다. 폴백이 일어나면 이 단언이 실패한다(고정 포트와 우연히 다르더라도
 * "컨테이너 포트와 다르다"는 사실 자체로 검출된다).
 */
@SpringBootTest
class TestcontainersIsolationTest {

    @Autowired private DataSource dataSource;

    @Autowired private RedisConnectionFactory redisConnectionFactory;

    @Test
    void datasource_connects_to_the_testcontainers_postgres_not_the_fixed_local_port() throws SQLException {
        int expectedPort = TestcontainersConfiguration.postgresMappedPort();

        try (Connection connection = dataSource.getConnection()) {
            String jdbcUrl = connection.getMetaData().getURL();

            assertThat(jdbcUrl)
                    .as("datasource URL은 Testcontainers Postgres의 매핑 포트를 가리켜야 한다")
                    .contains(":" + expectedPort + "/");
            assertThat(jdbcUrl)
                    .as("고정 포트 5432(상시 로컬/CI 인프라)로 폴백하지 않아야 한다")
                    .doesNotContain(":5432/");
        }

        assertThat(expectedPort).isNotEqualTo(5432);
    }

    @Test
    void redis_connects_to_the_testcontainers_redis_not_the_fixed_local_port() {
        int expectedPort = TestcontainersConfiguration.redisMappedPort();

        assertThat(redisConnectionFactory).isInstanceOf(LettuceConnectionFactory.class);
        LettuceConnectionFactory lettuce = (LettuceConnectionFactory) redisConnectionFactory;

        assertThat(lettuce.getPort())
                .as("Redis 커넥션 팩토리는 Testcontainers Redis의 매핑 포트를 가리켜야 한다")
                .isEqualTo(expectedPort);
        assertThat(lettuce.getPort())
                .as("고정 포트 6379(상시 로컬/CI 인프라)로 폴백하지 않아야 한다")
                .isNotEqualTo(6379);
    }
}
