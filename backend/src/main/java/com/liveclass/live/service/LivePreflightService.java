package com.liveclass.live.service;

import com.liveclass.live.domain.LiveSession;
import com.liveclass.live.repository.LiveSessionRepository;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 방 준비와 강사 publisher readiness 검사(ADR-0002 §1). preflight는 화면 토글 확인이 아니라
 * <b>방송 시작 전 실제 미디어 연결 점검</b>이다 — FE의 로컬 boolean이 아니라 LiveKit 서버에서
 * participant와 track을 다시 조회해 판정한다.
 *
 * <p>{@link #check}는 preflight 엔드포인트와 LIVE 직전 Gate S3①(§7)이 <b>함께 쓰는 단일 구현</b>이다.
 * 두 곳에서 판정이 갈리면 preflight를 통과한 세션이 LIVE 직전에 이유 없이 막히거나, 반대로 빈 방이
 * LIVE로 노출될 수 있다.
 */
@Service
public class LivePreflightService {

    private final LiveSessionRepository liveSessionRepository;
    private final LiveRoomControl roomControl;
    private final LivePreflightRoomStore roomStore;

    public LivePreflightService(LiveSessionRepository liveSessionRepository, LiveRoomControl roomControl,
                                LivePreflightRoomStore roomStore) {
        this.liveSessionRepository = liveSessionRepository;
        this.roomControl = roomControl;
        this.roomStore = roomStore;
    }

    /**
     * 방을 준비하고 {@code roomSid}를 저장한다(멱등). 강사가 preflight에 진입할 때 1회 호출한다.
     * 이걸 하지 않으면 강사가 접속하는 순간 LiveKit이 방을 암묵 생성해 {@code roomSid}가 영원히 빈 채로 남는다.
     */
    public PreparedRoom prepareRoom(UUID sessionId, UUID requesterId) {
        requireStartableOwned(sessionId, requesterId);
        String room = LiveSessionService.roomName(sessionId);
        // 외부 LiveKit 호출 중에는 DB 트랜잭션을 열어 두지 않는다.
        String roomSid = roomControl.ensureRoom(room);
        roomStore.saveRoomSid(sessionId, requesterId, roomSid);
        return new PreparedRoom(sessionId, room, roomSid);
    }

    /** 강사 readiness 재검증(preflight 엔드포인트용). 소유권을 확인한 뒤 {@link #check}로 위임한다. */
    public PreflightCheck checkOwned(UUID sessionId, UUID requesterId) {
        LiveSession session = requireOwnedSession(sessionId, requesterId);
        return check(sessionId, session.getInstructorId());
    }

    /**
     * 방 상태에서 강사 publisher 준비 여부를 판정한다.
     *
     * <p><b>막는 조건은 둘뿐이다</b> — 소유 강사 participant가 방에 있을 것, 강사 외 microphone
     * publisher가 없을 것(둘이면 소리가 겹친다). 강사 자신의 microphone track도 하나를 넘지 않아야
     * 한다(같은 이유).
     *
     * <p><b>마이크 유무·음소거는 막지 않는다.</b> 예전에는 unmuted microphone 하나를 필수로 요구했는데,
     * 그 조건이 재려던 것은 "강사가 실제로 방에 있는가"였고 그건 {@code instructorPresent}가 그대로
     * 만족한다(§ADR-0099). 마이크가 없다고 강의를 못 열 이유는 없다 — Egress는 트랙을 믹스하지 않고
     * 헤드리스 Chrome의 재생 출력을 담으므로(ADR-0048), 오디오가 없으면 실패가 아니라 무음이다.
     *
     * <p>대신 판정 결과의 나머지 필드로 화면이 <b>무음으로 시작한다는 사실을 강사에게 알린다</b>.
     * 무음은 조용히 실패하는 종류라 알려 주지 않으면 강의가 끝난 뒤에야 드러난다.
     */
    public PreflightCheck check(UUID sessionId, UUID instructorId) {
        String room = LiveSessionService.roomName(sessionId);
        String instructorIdentity = LiveParticipantIdentity.of(sessionId, instructorId);

        // 조회 장애를 "마이크 미준비"로 숨기지 않는다. preflight와 /start에서는 502로 구분되고,
        // 비동기 Gate S3에서는 오케스트레이터가 시작 실패로 접어 LIVE 공개를 막는다.
        List<LiveRoomControl.ParticipantMediaState> states = roomControl.listParticipantMediaStates(room);

        Optional<LiveRoomControl.ParticipantMediaState> instructor = states.stream()
                .filter(s -> instructorIdentity.equals(s.identity()))
                .findFirst();
        long otherMicPublishers = states.stream()
                .filter(s -> !instructorIdentity.equals(s.identity()))
                .filter(LiveRoomControl.ParticipantMediaState::microphonePublished)
                .count();

        boolean present = instructor.isPresent();
        boolean published = instructor.map(LiveRoomControl.ParticipantMediaState::microphonePublished).orElse(false);
        boolean muted = instructor.map(LiveRoomControl.ParticipantMediaState::microphoneMuted).orElse(false);
        int microphoneTrackCount = instructor
                .map(LiveRoomControl.ParticipantMediaState::microphoneTrackCount).orElse(0);
        boolean ready = present && microphoneTrackCount <= 1 && otherMicPublishers == 0;
        return new PreflightCheck(ready, present, published, muted,
                microphoneTrackCount, (int) otherMicPublishers);
    }

    /** 시작 전(DRAFT/SCHEDULED/OPEN/STARTING) 세션의 강사만 preflight를 할 수 있다. */
    private LiveSession requireStartableOwned(UUID sessionId, UUID requesterId) {
        LiveSession session = requireOwnedSession(sessionId, requesterId);
        switch (session.getStatus()) {
            case DRAFT, SCHEDULED, OPEN, STARTING, LIVE -> { /* ok */ }
            default -> throw new LiveSessionStateConflictException("이미 종료되었거나 시작할 수 없는 상태입니다.");
        }
        return session;
    }

    private LiveSession requireOwnedSession(UUID sessionId, UUID requesterId) {
        LiveSession session = liveSessionRepository.findById(sessionId)
                .orElseThrow(() -> new LiveSessionNotFoundException("라이브 세션을 찾을 수 없습니다."));
        if (!session.getInstructorId().equals(requesterId)) {
            throw new LiveSessionForbiddenException("이 세션의 강사만 할 수 있습니다.");
        }
        return session;
    }

    /** preflight 방 준비 결과. */
    public record PreparedRoom(UUID sessionId, String roomName, String roomSid) {
    }

    /**
     * 강사 publisher 준비 판정 결과.
     *
     * @param ready                       시작해도 되는가 — 강사가 방에 있고 마이크가 겹치지 않는가.
     *                                    <b>마이크 유무는 여기 들어가지 않는다</b>(ADR-0099).
     * @param instructorPresent           소유 강사 participant가 방에 있는가
     * @param microphonePublished         그 강사가 마이크를 publish 중인가(false여도 시작할 수 있다)
     * @param microphoneMuted             그 마이크가 muted인가(true여도 시작할 수 있다)
     * @param unexpectedMicrophonePublishers 강사 외 마이크 publisher 수(0이어야 한다)
     */
    public record PreflightCheck(boolean ready, boolean instructorPresent,
                                 boolean microphonePublished, boolean microphoneMuted,
                                 int instructorMicrophoneTrackCount,
                                 int unexpectedMicrophonePublishers) {
    }
}
