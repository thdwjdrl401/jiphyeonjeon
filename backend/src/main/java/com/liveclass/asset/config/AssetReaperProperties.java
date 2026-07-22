package com.liveclass.asset.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * 미완료(PENDING) 에셋 회수 설정. 값은 application.yml의 asset.reaper.* 에서 온다.
 * 실행 주기(fixedDelay·initialDelay)는 {@code @Scheduled}가 플레이스홀더로 직접 읽지만,
 * 설정 메타데이터·문서화를 위해 여기에도 선언해 둔다.
 */
@ConfigurationProperties("asset.reaper")
public class AssetReaperProperties {

    /**
     * 이 시간(시)보다 오래된 PENDING 에셋을 FAILED로 회수한다.
     * presigned PUT TTL(기본 10분)보다 충분히 뒤로 잡아 늦은 완료 통지를 잡아먹지 않게 한다.
     */
    private long pendingExpiryHours = 24;

    /** 회수 실행 간격(직전 실행 종료 기준). */
    private Duration fixedDelay = Duration.ofHours(1);

    /** 기동 후 첫 실행까지의 지연. 부팅 직후 부하와 겹치지 않게 띄운다. */
    private Duration initialDelay = Duration.ofMinutes(5);

    public long getPendingExpiryHours() {
        return pendingExpiryHours;
    }

    public void setPendingExpiryHours(long pendingExpiryHours) {
        this.pendingExpiryHours = pendingExpiryHours;
    }

    public Duration getFixedDelay() {
        return fixedDelay;
    }

    public void setFixedDelay(Duration fixedDelay) {
        this.fixedDelay = fixedDelay;
    }

    public Duration getInitialDelay() {
        return initialDelay;
    }

    public void setInitialDelay(Duration initialDelay) {
        this.initialDelay = initialDelay;
    }
}
