package com.liveclass.live.service;

import com.liveclass.live.domain.LiveCaption;
import com.liveclass.live.repository.LiveCaptionRepository;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * attempt 시간 앵커로 <b>정확한</b> 세션-ms를 계산한다(ADR-0052 앵커, ADR-0053 후속).
 *
 * <p>{@code caption.stream.started}가 그 attempt의 첫 오디오 프레임 절대시각({@code audioStartedAt})을
 * 준다. 즉 <b>"이 attempt의 streamElapsedMs 0이 세션 시계로 몇 ms인가"</b>를 알 수 있고, 그러면
 * {@code 앵커 + streamElapsedMs}가 근사가 아니라 정확한 세션-ms가 된다.
 *
 * <p>이는 CONTRACT §3-4가 금지한 "앵커 없는 streamElapsedMs→세션ms 환산"이 <b>아니다</b> — 금지된 것은
 * 앵커 없이 짐작하는 것이고, 여기서는 실제 앵커 행을 읽어 적용한다({@code ReplayAiContextService}가 AI
 * 근거 경로에서 이미 같은 변환을 한다). 앵커가 없으면 지어내지 않고 {@code null}을 돌려주어, 호출자가
 * 종전의 근사 축({@link CaptionSessionMs})으로 물러나게 한다.
 *
 * <p><b>캐시</b> — 앵커는 attempt당 하나이고 한 번 정해지면 불변이라(같은 attempt의 started가 두 번 와도
 * 첫 것이 0의 정의다) 세션별로 캐시한다. 못 찾은 attempt도 기억한다 — 앵커 없는 옛 세션에서 델타마다
 * DB를 다시 뒤지는 것을 막기 위해서다. agent는 오디오를 넘기기 전에 반드시 {@code started}를 먼저
 * 발행하므로(realtime-agent {@code dispatched_room_job}) 델타가 앵커를 앞지르는 순서는 나오지 않는다.
 */
@Component
public class CaptionAnchorLookup {

    private final LiveCaptionRepository liveCaptionRepository;
    private final SessionClockLookup sessionClockLookup;
    private final ConcurrentHashMap<UUID, Map<String, Long>> anchorCache = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<UUID, Set<String>> missingCache = new ConcurrentHashMap<>();

    public CaptionAnchorLookup(LiveCaptionRepository liveCaptionRepository,
                               SessionClockLookup sessionClockLookup) {
        this.liveCaptionRepository = liveCaptionRepository;
        this.sessionClockLookup = sessionClockLookup;
    }

    /**
     * {@code 앵커 + streamElapsedMs}. 앵커나 좌표가 없으면 null(호출자가 근사로 물러난다).
     *
     * <p>음수는 0으로 clamp한다 — 세션 원점보다 이른 발화는 재생 축에 자리가 없다. 근사 축
     * ({@link CaptionSessionMs})과 같은 규칙이라 두 축이 경계에서 어긋나지 않는다.
     */
    public Long anchoredSessionMs(UUID sessionId, String sttSessionId, Long streamElapsedMs) {
        if (sttSessionId == null || streamElapsedMs == null) {
            return null;
        }
        Long anchor = anchor(sessionId, sttSessionId);
        return anchor == null ? null : Math.max(0L, anchor + streamElapsedMs);
    }

    private Long anchor(UUID sessionId, String sttSessionId) {
        Map<String, Long> cached = anchorCache.get(sessionId);
        if (cached != null && cached.containsKey(sttSessionId)) {
            return cached.get(sttSessionId);
        }
        if (missingCache.getOrDefault(sessionId, Set.of()).contains(sttSessionId)) {
            return null;
        }
        Map<String, Long> loaded = load(sessionId);
        anchorCache.put(sessionId, loaded);
        Long anchor = loaded.get(sttSessionId);
        if (anchor == null) {
            missingCache.computeIfAbsent(sessionId, key -> ConcurrentHashMap.newKeySet()).add(sttSessionId);
        }
        return anchor;
    }

    private Map<String, Long> load(UUID sessionId) {
        OffsetDateTime clockOriginAt = sessionClockLookup.clockOriginAt(sessionId);
        if (clockOriginAt == null) {
            return Map.of();
        }
        Map<String, Long> anchors = new HashMap<>();
        for (LiveCaption row : liveCaptionRepository.findBySessionIdAndEventTypeOrderByIdAsc(
                sessionId, CaptionEvent.TYPE_STARTED)) {
            if (row.getSttSessionId() == null || row.getAudioStartedAt() == null) {
                continue;
            }
            // 같은 attempt의 started가 두 번 오면 첫 것을 쓴다 — 0의 정의가 바뀌면 안 된다.
            anchors.putIfAbsent(row.getSttSessionId(),
                    Duration.between(clockOriginAt, row.getAudioStartedAt()).toMillis());
        }
        return anchors;
    }
}
