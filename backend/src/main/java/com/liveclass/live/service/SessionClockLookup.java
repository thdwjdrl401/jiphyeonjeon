package com.liveclass.live.service;

import com.liveclass.live.repository.LiveSessionRepository;
import org.springframework.stereotype.Component;

import java.time.OffsetDateTime;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 세션 클록 원점({@code clockOriginAt})을 조회해 근사 세션-ms를 계산한다(ADR-0045). 자막 델타는 빈번해
 * 이벤트마다 세션을 다시 읽지 않도록 {@code clockOriginAt}을 세션별로 캐시한다 — 이 값은 LIVE 전환에서
 * 한 번 정해지면 불변이라 캐시가 안전하다. 아직 정해지지 않았으면(null) 캐시하지 않아 다음 조회에서
 * 다시 확인한다.
 *
 * <p>브로드캐스트 경로({@code WsCaptionBroadcaster})와 리로드 경로({@code LiveCaptionService.reload})가 함께 쓴다.
 */
@Component
public class SessionClockLookup {

    private final LiveSessionRepository liveSessionRepository;
    private final ConcurrentHashMap<UUID, OffsetDateTime> clockOriginCache = new ConcurrentHashMap<>();

    public SessionClockLookup(LiveSessionRepository liveSessionRepository) {
        this.liveSessionRepository = liveSessionRepository;
    }

    /** occurredAt의 근사 세션-ms(≥0). clockOriginAt이 아직 없거나 occurredAt이 없으면 null. */
    public Long approxSessionMs(UUID sessionId, OffsetDateTime occurredAt) {
        return CaptionSessionMs.approximate(clockOriginAt(sessionId), occurredAt);
    }

    private OffsetDateTime clockOriginAt(UUID sessionId) {
        OffsetDateTime cached = clockOriginCache.get(sessionId);
        if (cached != null) {
            return cached;
        }
        OffsetDateTime origin = liveSessionRepository.findById(sessionId)
                .map(session -> session.getClockOriginAt())
                .orElse(null);
        if (origin != null) {
            clockOriginCache.put(sessionId, origin);   // 불변 값만 캐시
        }
        return origin;
    }
}
