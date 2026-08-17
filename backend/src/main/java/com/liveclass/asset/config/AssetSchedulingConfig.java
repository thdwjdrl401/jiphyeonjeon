package com.liveclass.asset.config;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * 스케줄링 활성화. 공유 커널(common)을 건드리지 않도록 스케줄러가 필요한 모듈에서 켠다.
 *
 * <p><b>이 앱에서 {@code @EnableScheduling}은 여기 한 곳뿐이다.</b> 처음에는 미완료 에셋
 * 회수(AssetReaper) 하나를 위한 것이었지만, 지금은 아웃박스 릴레이·라이브 정합·전사 디스패치·
 * 파티션 유지 등 열두 개 남짓한 {@code @Scheduled}가 전부 이 스위치에 매달려 있다.
 *
 * <p>그래서 이 한 줄이 <b>노드 역할을 가르는 수단</b>이 된다(ADR-0127). 발송 전용 노드는
 * {@code liveclass.scheduling.enabled=false}로 떠서 배경 작업을 전부 멈추고 푸시 큐만 소비한다.
 * 그렇게 하는 이유는 낭비가 아니라 <b>정확성</b>이다 — 이 앱의 주기 작업 중 여러 대가 동시에 돌아도
 * 안전하다고 확인된 것은 일부뿐이고(AssetReaper의 PENDING→FAILED 전이,
 * AnnotationHighlightDescribeWorker의 아웃박스 UNIQUE), {@code LiveStartingSoonScheduler}는
 * 잠금이 없어 두 노드가 같은 예정 행을 집으면 아웃박스에 두 줄을 넣는다고 스스로 적어 두고 있다.
 * 노드를 늘리기 전에 그 전부를 감사하는 대신, 늘어나는 노드에서는 주기 작업을 아예 돌리지 않는다.
 *
 * <p>빈을 지우는 방식이 아니라 스케줄링 등록만 끄는 방식이라 주입 관계는 그대로다 — 잡 빈들은
 * 여전히 존재하고, 다른 코드가 직접 부르는 경로(예: 라이브 종료 시 즉시 정합)는 살아 있다.
 */
@Configuration
@EnableConfigurationProperties(AssetReaperProperties.class)
public class AssetSchedulingConfig {

    /**
     * 스케줄링 등록만 조건부로 가른다.
     *
     * <p>바깥 클래스에 조건을 걸면 {@code @EnableConfigurationProperties}까지 함께 사라져
     * {@link AssetReaperProperties}를 주입받는 {@code AssetReaper}가 기동을 실패시킨다. 끄려는 것은
     * 설정이 아니라 <b>주기 실행</b>이므로, 조건은 여기에만 붙는다.
     */
    @Configuration
    @ConditionalOnProperty(name = "liveclass.scheduling.enabled", havingValue = "true", matchIfMissing = true)
    @EnableScheduling
    static class SchedulingActivation {
    }
}
