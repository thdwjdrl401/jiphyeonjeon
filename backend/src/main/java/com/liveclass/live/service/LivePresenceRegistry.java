package com.liveclass.live.service;

import com.liveclass.live.api.LivePresenceDirectory;
import com.liveclass.live.api.LivePresentUser;
import org.springframework.stereotype.Component;

import java.time.OffsetDateTime;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 라이브 강의실에 지금 들어와 있는 <b>수강생</b> 집계.
 *
 * <p><b>왜 LiveKit이 아니라 STOMP 구독을 세는가</b>: 수강생은 LiveKit 방에 들어오지 않는다(ADR-0032 —
 * 학생 재생은 HLS 단일). {@code listParticipants}가 돌려주는 것은 강사·Egress·STT 에이전트뿐이라
 * 그걸 "참여 중"으로 보여주면 청중과 무관한 숫자가 된다. 반면 강의실을 연 사람은 반드시 세션
 * 토픽을 구독하므로, 구독이 유일하게 정확한 접속 신호다.
 *
 * <p><b>강사는 세지 않는다.</b> "N명 참여 중"은 강사가 자기 강의를 몇 명이 듣고 있는지 보는 숫자다.
 * 자기 자신이 포함되면 혼자일 때 1이 되어 오해를 만든다.
 *
 * <p><b>사람 단위로 센다.</b> 한 사람이 탭을 두 개 열면 WebSocket 세션이 둘이지만 한 명이다.
 * 같은 사용자의 연결 수가 아니라 서로 다른 사용자 수를 센다.
 *
 * <p>단일 인스턴스 전제다 — SimpleBroker와 같은 전제 위에 있다(ADR-0019). 여러 인스턴스로 늘리면
 * 브로커를 외부 relay로 바꾸는 기존 과제와 함께 이 집계도 공유 저장소로 옮겨야 한다.
 */
@Component
public class LivePresenceRegistry implements LivePresenceDirectory {

    /** WebSocket 세션 하나가 어느 라이브의 누구인지. 구독이 여러 개여도 연결 하나가 사람 하나다. */
    private final Map<String, Presence> byConnection = new ConcurrentHashMap<>();

    /**
     * 연결을 등록한다. 같은 연결이 토픽을 여러 개 구독해도 한 번만 등록된다.
     *
     * @return 이 등록으로 <b>새 연결이 잡혔는가</b>. 이미 등록된 연결이면 false
     */
    public boolean join(String connectionId, UUID liveSessionId, UUID userId, boolean instructor) {
        Presence added = new Presence(liveSessionId, userId, instructor, OffsetDateTime.now());
        return byConnection.putIfAbsent(connectionId, added) == null;
    }

    /**
     * 연결을 지운다.
     *
     * @return 그 연결이 속해 있던 라이브 세션. 등록된 적 없는 연결이면 empty
     */
    public Optional<UUID> leave(String connectionId) {
        Presence removed = byConnection.remove(connectionId);
        return Optional.ofNullable(removed).map(Presence::liveSessionId);
    }

    /** 지금 이 라이브를 듣고 있는 수강생 수(강사 제외, 사람 단위). */
    public int audienceCount(UUID liveSessionId) {
        Set<UUID> distinct = ConcurrentHashMap.newKeySet();
        byConnection.values().stream()
                .filter(p -> !p.instructor() && p.liveSessionId().equals(liveSessionId))
                .forEach(p -> distinct.add(p.userId()));
        return distinct.size();
    }

    /**
     * 지금 이 라이브에 들어와 있는 사람들(강사 포함, 사람 단위).
     *
     * <p>세는 것과 달리 <b>강사를 빼지 않는다</b>. "N명 참여 중"은 강사가 자기 청중을 보는 숫자라
     * 자기 자신이 빠져야 하지만, 운영자가 보는 목록은 강사가 들어와 있는지도 답해야 한다 —
     * 시작은 됐는데 강사가 안 들어온 세션이 실제로 문의가 되는 경우다.
     *
     * <p>한 사람이 탭을 여럿 열었으면 <b>가장 이른</b> 접속 시각을 남긴다. 뒤에 연 탭의 시각을 쓰면
     * 탭을 열 때마다 "방금 들어온 사람"으로 보인다.
     */
    @Override
    public List<LivePresentUser> presentIn(UUID liveSessionId) {
        Map<UUID, LivePresentUser> byUser = new HashMap<>();
        byConnection.values().stream()
                .filter(p -> p.liveSessionId().equals(liveSessionId))
                .forEach(p -> byUser.merge(
                        p.userId(),
                        new LivePresentUser(p.userId(), p.instructor(), p.since()),
                        (kept, incoming) -> incoming.since().isBefore(kept.since()) ? incoming : kept));
        return byUser.values().stream()
                .sorted(Comparator.comparing(LivePresentUser::since))
                .toList();
    }

    private record Presence(UUID liveSessionId, UUID userId, boolean instructor, OffsetDateTime since) {
    }
}
