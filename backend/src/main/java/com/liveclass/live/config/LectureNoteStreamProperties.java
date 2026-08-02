package com.liveclass.live.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * 강의 노트 Redis Stream consumer 설정(CONTRACT §3-4a). 자막(§3-4)과 같은 프로필 구동 Redis를 본다.
 *
 * <p>group 이름은 계약이 정한 {@code spring-lecture-notes-live-v1}이다 — ai-api가 자기 group으로 이미
 * 자막을 소비하고 있어 반드시 별도 그룹이어야 한다.
 *
 * <p>기본이 <b>꺼짐</b>이다. 자막과 다른 선택인데, 이 소비는 아직 실제 강의로 검증되지 않았고 켜는
 * 순간 운영 노트가 쌓이기 시작한다. 환경별로 명시적으로 켠다.
 */
@ConfigurationProperties("liveclass.lecture-note")
public record LectureNoteStreamProperties(
        Boolean enabled,
        String streamKey,
        String group,
        String groupInstanceSuffix,
        String consumer,
        Integer batchSize,
        Duration pollTimeout
) {

    public LectureNoteStreamProperties {
        enabled = Boolean.TRUE.equals(enabled);   // 기본 꺼짐 — 켜는 것은 환경별 결정이다
        streamKey = hasText(streamKey) ? streamKey : "ai:lecture-notes:mvp";
        group = hasText(group) ? group : "spring-lecture-notes-live-v1";
        consumer = hasText(consumer) ? consumer : defaultConsumerName();
        batchSize = (batchSize != null && batchSize > 0) ? batchSize : 50;
        pollTimeout = (pollTimeout != null && !pollTimeout.isZero() && !pollTimeout.isNegative())
                ? pollTimeout : Duration.ofSeconds(1);
    }

    public boolean enabledFlag() {
        return Boolean.TRUE.equals(enabled);
    }

    /** 접미사가 있으면 붙인 유효 그룹 이름(dev 인프라를 여러 개발자가 공유할 때 분리). */
    public String effectiveGroup() {
        return hasText(groupInstanceSuffix) ? group + "-" + groupInstanceSuffix : group;
    }

    private static boolean hasText(String s) {
        return s != null && !s.isBlank();
    }

    /** 호스트명 기반 안정 consumer 이름. 안정적이어야 재기동 시 자기 pending을 되찾는다. */
    private static String defaultConsumerName() {
        String host = System.getenv("HOSTNAME");
        if (!hasText(host)) {
            host = System.getProperty("hostname");
        }
        return hasText(host) ? "spring-notes-" + host : "spring-lecture-note-consumer";
    }
}
