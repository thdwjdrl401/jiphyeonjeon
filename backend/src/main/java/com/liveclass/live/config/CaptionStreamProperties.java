package com.liveclass.live.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * 라이브 자막 Redis Stream consumer 설정(ADR-0043, CONTRACT §3-4). 소비 대상 Redis는 별도 설정이 아니라
 * {@code spring.data.redis}가 가리키는 <b>프로필 구동 Redis</b>다(기본 로컬, {@code remote} 프로필이면
 * EC2 :4000 application Redis — GPU realtime-agent가 실제로 캡션을 쓰는 곳).
 *
 * <ul>
 *   <li>{@code streamKey} — 전역 스트림 키(env {@code CAPTION_STREAM_KEY}와 정합, 기본 {@code ai:captions:live}).</li>
 *   <li>{@code group} — Spring 전용 consumer group. ai-api가 {@code ai-rag-live-v1}로 이미 소비하므로
 *       반드시 별도 그룹이어야 한다(기본 {@code spring-caption-live-v1}).</li>
 *   <li>{@code groupInstanceSuffix} — dev 인프라를 여러 개발자가 공유할 때 그룹을 분리하는 접미사
 *       ({@code application-remote.yml}의 경고). 비면 접미사 없음.</li>
 *   <li>{@code consumer} — 그룹 안의 consumer 이름(=인스턴스 식별자). 안정적이어야 재기동 시 자기 pending을
 *       다시 집는다.</li>
 * </ul>
 */
@ConfigurationProperties("liveclass.caption")
public record CaptionStreamProperties(
        Boolean enabled,
        String streamKey,
        String group,
        String groupInstanceSuffix,
        String consumer,
        Integer batchSize,
        Duration pollTimeout
) {

    public CaptionStreamProperties {
        enabled = enabled == null || enabled;   // 기본 활성 — 프로필 구동 Redis를 그대로 소비
        streamKey = hasText(streamKey) ? streamKey : "ai:captions:live";
        group = hasText(group) ? group : "spring-caption-live-v1";
        consumer = hasText(consumer) ? consumer : defaultConsumerName();
        batchSize = (batchSize != null && batchSize > 0) ? batchSize : 100;
        pollTimeout = (pollTimeout != null && !pollTimeout.isZero() && !pollTimeout.isNegative())
                ? pollTimeout : Duration.ofSeconds(1);
    }

    public boolean enabledFlag() {
        return Boolean.TRUE.equals(enabled);
    }

    /** 접미사가 있으면 붙인 유효 그룹 이름(개발자별 그룹 분리). */
    public String effectiveGroup() {
        return hasText(groupInstanceSuffix) ? group + "-" + groupInstanceSuffix : group;
    }

    private static boolean hasText(String s) {
        return s != null && !s.isBlank();
    }

    /** 호스트명 기반 안정 consumer 이름. 못 구하면 고정 접두사. */
    private static String defaultConsumerName() {
        String host = System.getenv("HOSTNAME");
        if (!hasText(host)) {
            host = System.getProperty("hostname");
        }
        return hasText(host) ? "spring-" + host : "spring-caption-consumer";
    }
}
