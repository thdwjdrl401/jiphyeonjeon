package com.liveclass.support;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * 모든 @SpringBootTest가 공유하는 Testcontainers 인프라(ADR-0038).
 *
 * <p>로컬 compose 인프라(고정 포트 5432/6379)에 의존하지 않고 랜덤 포트 컨테이너 1쌍을
 * 스위트 전체가 공유한다. 개별 테스트 파일을 고치지 않도록 이 설정은
 * {@link TestcontainersContextCustomizerFactory}가 모든 컨텍스트에 자동 주입한다.
 *
 * <p>싱글턴 컨테이너 패턴: static 초기화에서 한 번 start 하고 {@code @Container}로
 * 라이프사이클을 걸지 않는다. JVM 종료 시 Testcontainers Ryuk이 회수하는 것이 기본 경로지만,
 * Ryuk을 비활성화한 로컬 환경을 위해 JVM shutdown hook에서도 stop()한다(아래). 여러
 * @SpringBootTest 컨텍스트가 캐시되어도 같은 컨테이너에 붙는다.
 *
 * <p>이미지는 운영/dev와 동일하게 맞춘다 — Postgres는 pgvector 확장 이미지, Redis는 7-alpine.
 * {@code @ServiceConnection}이 datasource/redis 접속 정보를 컨테이너에서 뽑아 주입하므로
 * application.yml의 localhost 기본값은 override 된다.
 */
@TestConfiguration(proxyBeanMethods = false)
public class TestcontainersConfiguration {

    private static final DockerImageName POSTGRES_IMAGE =
            DockerImageName.parse("pgvector/pgvector:pg16").asCompatibleSubstituteFor("postgres");

    private static final DockerImageName REDIS_IMAGE = DockerImageName.parse("redis:7-alpine");

    // 스위트 전체 공유(싱글턴). Ryuk이 있으면 JVM 종료 시 회수하지만, 로컬에서 Ryuk을 비활성화한
    // 경우(Colima 워크어라운드, RUN.md 참고)를 위해 shutdown hook으로도 stop()한다(아래 static 블록).
    // Testcontainers 2.0의 PostgreSQLContainer는 제네릭 파라미터가 없다(self-type).
    private static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(POSTGRES_IMAGE)
            .withDatabaseName("liveclass")
            .withUsername("liveclass")
            .withPassword("liveclass");

    private static final GenericContainer<?> REDIS = new GenericContainer<>(REDIS_IMAGE)
            .withExposedPorts(6379);

    static {
        // start() 실패(도커 데몬 접근 불가·이미지 pull 실패 등)를 감싸지 않으면 이 클래스의 static
        // 초기화가 ExceptionInInitializerError로 실패하고, 두 번째 테스트부터는 JVM이 이미 "초기화
        // 실패한 클래스"로 기억해 NoClassDefFoundError만 던진다 — 원인이 로그에서 사라진다.
        // 여기서 잡아 원인을 포함한 명확한 메시지로 다시 던져 첫 실패 로그에서 바로 원인이 보이게 한다.
        try {
            POSTGRES.start();
            REDIS.start();
        } catch (RuntimeException e) {
            throw new IllegalStateException(
                    "Testcontainers 인프라(Postgres+Redis) 기동 실패 — 도커 데몬 접근 가능 여부·이미지 pull·"
                            + "(로컬 Colima 환경이면 RUN.md 6절의 DOCKER_HOST/TESTCONTAINERS_* 설정)을 확인하라.",
                    e);
        }
        Runtime.getRuntime()
                .addShutdownHook(
                        new Thread(
                                () -> {
                                    // Ryuk이 비활성화된 로컬 환경(TESTCONTAINERS_RYUK_DISABLED=true)에서
                                    // 컨테이너가 남지 않도록 안전망으로 stop한다. Ryuk이 살아있으면 이미
                                    // 정리했을 것이므로 stop()은 멱등하게 무해하다.
                                    REDIS.stop();
                                    POSTGRES.stop();
                                }));
    }

    /**
     * <b>RabbitMQ 컨테이너는 띄우지 않는다.</b> 테스트가 검증하는 것은 메시지가 브로커를 왕복하는
     * 일이 아니라 <b>어떤 메시지를 어디로 보내는가</b>와 <b>워커가 그 메시지로 무엇을 만드는가</b>라,
     * 발행은 목으로 확인하고 워커는 직접 부른다.
     *
     * <p>다만 {@code @RabbitListener}는 컨텍스트가 뜨는 순간 브로커에 붙으려 하고, 없으면 재접속을
     * 계속 시도하며 모든 테스트 로그를 채운다. 그래서 리스너 <b>기동만</b> 꺼 둔다 — 선언과 배선은
     * 그대로 검증되고, 실제 소비 경로는 워커를 직접 호출해 확인한다.
     */
    @DynamicPropertySource
    static void disableRabbitListeners(DynamicPropertyRegistry registry) {
        registry.add("spring.rabbitmq.listener.simple.auto-startup", () -> "false");
    }

    @Bean
    @ServiceConnection
    PostgreSQLContainer postgresContainer() {
        return POSTGRES;
    }

    // redis:7-alpine은 Boot 4.1 RedisContainerConnectionDetailsFactory가 이미지명으로 매칭하지만,
    // name 힌트를 명시해 GenericContainer 매칭을 확실히 한다.
    @Bean
    @ServiceConnection(name = "redis")
    GenericContainer<?> redisContainer() {
        return REDIS;
    }

    /**
     * 격리 증명 테스트({@code TestcontainersIsolationTest})가 실제 컨테이너 매핑 포트와
     * 스프링이 주입한 접속 정보를 비교하기 위한 접근자. 고정 포트(5432/6379) 폴백이 조용히
     * 일어나도 그린이 되는 상황을 막으려면 "실제로 어느 포트에 붙었는지"를 독립적으로 확인해야 한다.
     */
    static int postgresMappedPort() {
        return POSTGRES.getMappedPort(5432);
    }

    static int redisMappedPort() {
        return REDIS.getMappedPort(6379);
    }
}
