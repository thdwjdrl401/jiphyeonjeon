package com.liveclass.live.service;

import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 발화 벽시계를 세션-ms로 옮긴다(ADR-0107).
 *
 * <p>agent가 {@code segment.final}에 그 발화가 실제로 시작한 UTC 시각을 실어 준다. 세션 원점
 * ({@code clockOriginAt})만 빼면 세션-ms가 되고, 그 값은 <b>근사가 아니다</b> — 도착 시각이 아니라
 * 발화 시각이므로 STT 지연 보정이 필요 없다.
 *
 * <p>한때 {@code audioStartedAt + streamElapsedMs}로 같은 값을 구하려 했다가 실패했다(ADR-0106).
 * {@code streamElapsedMs}가 받은 오디오의 누적 길이라 무음이 빠지고, 그 폭이 세션마다 0.6초~21초로
 * 달라 상수로 메울 수 없었다. 그래서 <b>생산자가 직접 벽시계를 싣는</b> 쪽으로 바꿨다.
 *
 * <p>시각이 없으면(옛 행, agent 미지원) {@code null}을 돌려주고 소비자가 근사 축으로 물러난다.
 */
@Component
public class CaptionSpeechClock {

    private final SessionClockLookup sessionClockLookup;

    public CaptionSpeechClock(SessionClockLookup sessionClockLookup) {
        this.sessionClockLookup = sessionClockLookup;
    }

    /** 발화 시작의 세션-ms(≥0). 벽시계나 세션 원점이 없으면 null. */
    public Long speechSessionMs(UUID sessionId, OffsetDateTime startedAt) {
        if (startedAt == null) {
            return null;
        }
        OffsetDateTime clockOriginAt = sessionClockLookup.clockOriginAt(sessionId);
        if (clockOriginAt == null) {
            return null;
        }
        // 세션 원점보다 이른 발화는 재생 축에 자리가 없다. 근사 축(CaptionSessionMs)과 같은 규칙이라
        // 두 축이 경계에서 어긋나지 않는다.
        return Math.max(0L, Duration.between(clockOriginAt, startedAt).toMillis());
    }
}
