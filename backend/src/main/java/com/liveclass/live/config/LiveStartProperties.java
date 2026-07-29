package com.liveclass.live.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * 라이브 시작 오케스트레이션 설정(ADR-0002 §4·§5-1).
 *
 * <p>{@code sttAssumeReady}는 <b>일시적 우회 플래그</b>다. realtime-agent 쪽 readiness API·callback이
 * 배포되기 전까지 Gate S1(job 배정 확인)·Gate S2({@code STT_READY} 수신)·Gate S3②(LIVE 직전 STT 재검증)를
 * 건너뛴다. explicit AgentDispatch 생성·재사용 자체는 여전히 필수이며 실패하면 Egress 전에 시작을 막는다.
 * 그동안 {@code captionEnabled=true} 세션이 자막
 * 없이 LIVE가 될 수 있다는 리스크를 명시적으로 감수한다(ADR §5-1). AI 담당자 API 배포 후 {@code false}로 전환한다.
 *
 * <p>강사 publisher 재검증(Gate S3①)은 이 플래그와 <b>무관하게 항상</b> 수행한다 — 빈 방이 LIVE로
 * 노출되는 것을 막는 유일한 방어선이기 때문이다.
 */
@ConfigurationProperties("live")
public record LiveStartProperties(Stt stt, Start start) {

    public LiveStartProperties {
        stt = stt != null ? stt : new Stt(true);
        start = start != null ? start : new Start(null, null, null);
    }

    public record Stt(Boolean assumeReady) {

        public Stt {
            assumeReady = assumeReady == null || assumeReady;   // 기본값 true(ADR §5-1)
        }

        public boolean assumeReadyEnabled() {
            return Boolean.TRUE.equals(assumeReady);
        }
    }

    /**
     * Egress Gate B~C의 bounded polling 설정. ADR §4는 과거 Chrome page load가 20초까지 걸린 인프라
     * 기록을 근거로 45초를 시작값으로 제안한다 — 고정 상수가 아니라 운영 지표로 조정한다.
     */
    public record Start(Duration egressReadinessTimeout, Duration egressPollInterval,
                        Duration executionLease) {

        public Start {
            egressReadinessTimeout = egressReadinessTimeout != null ? egressReadinessTimeout : Duration.ofSeconds(45);
            egressPollInterval = egressPollInterval != null ? egressPollInterval : Duration.ofSeconds(1);
            // Egress timeout보다 길어야 정상 실행 중 reconciler가 같은 attempt를 다시 집지 않는다.
            executionLease = executionLease != null ? executionLease : Duration.ofSeconds(90);
            if (executionLease.compareTo(egressReadinessTimeout) <= 0) {
                throw new IllegalArgumentException("live.start.execution-lease는 egress-readiness-timeout보다 길어야 합니다.");
            }
        }
    }
}
