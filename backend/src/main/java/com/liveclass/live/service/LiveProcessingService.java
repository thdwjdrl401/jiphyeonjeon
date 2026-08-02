package com.liveclass.live.service;

import com.liveclass.live.api.LiveRecordingStatus;
import com.liveclass.live.domain.LiveSession;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 종료 후 처리 현황 조회. 라이브를 끝냈다고 영상이 곧바로 볼 수 있는 게 아니라서, 강사에게
 * <b>지금 어디까지 됐는지</b>를 보여주는 자리다.
 *
 * <p>ADR-0003이 못박은 대로 라이브 세션과 녹화 자산은 <b>독립된 상태축</b>이다. 세션이 {@code ENDED}가
 * 된 뒤에도 자산은 {@code FINALIZING → VERIFYING → READY}를 따로 지나가며, 그 전이는 Egress 완료
 * webhook이 나중에 몰고 온다. 이 조회는 그 두 축을 <b>접지 않고 그대로</b> 돌려준다 — 접으면
 * "영상은 준비됐지만 아직 게시 전"과 "게시까지 끝남"을 구분할 수 없다.
 */
@Service
public class LiveProcessingService {

    private final LiveSessionService liveSessionService;
    private final LiveRecordingStatus recordingStatus;

    public LiveProcessingService(LiveSessionService liveSessionService, LiveRecordingStatus recordingStatus) {
        this.liveSessionService = liveSessionService;
        this.recordingStatus = recordingStatus;
    }

    /** 소유 강사만. 없는 세션 404, 남의 세션 403. */
    @Transactional(readOnly = true)
    public LiveProcessingView get(UUID sessionId, UUID requesterId) {
        LiveSession session = liveSessionService.requireOwned(sessionId, requesterId);
        // 녹화 자산이 없을 수 있다 — 녹화를 끄고 진행했거나 아직 시작 전이다. 그 부재는 실패가 아니다.
        LiveRecordingStatus.RecordingStatusView asset = recordingStatus.findBySession(sessionId).orElse(null);
        return new LiveProcessingView(
                session.getId(),
                session.getStatus().name(),
                session.isRecordingEnabled(),
                session.getStartedAt(),
                session.getEndedAt(),
                asset);
    }

    /**
     * @param recordingEnabled 이 세션이 녹화를 켜고 진행했는가. {@code videoAsset}이 null일 때
     *                         "아직 안 만들어졌다"와 "애초에 녹화하지 않았다"를 구분하는 데 쓴다.
     * @param videoAsset       녹화 자산 상태. 없으면 null
     */
    public record LiveProcessingView(
            UUID sessionId,
            String liveSessionStatus,
            boolean recordingEnabled,
            OffsetDateTime startedAt,
            OffsetDateTime endedAt,
            LiveRecordingStatus.RecordingStatusView videoAsset) {
    }
}
