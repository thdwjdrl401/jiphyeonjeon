package com.liveclass.live.service;

import com.liveclass.asset.api.AssetDirectory;
import com.liveclass.asset.api.AssetRef;
import com.liveclass.live.domain.AnnotationHighlight;
import com.liveclass.live.domain.LiveSession;
import com.liveclass.live.repository.AnnotationHighlightRepository;
import com.liveclass.live.repository.LiveSessionRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * 강조 판서 스냅샷 저장·조회(ADR-0074).
 *
 * <p>강사가 강조 툴로 화면 일부를 표시하면 브라우저가 그 순간의 화면 + 판서를 합성해 자르고, 에셋으로
 * 올린 뒤 그 {@code assetId}를 여기로 보낸다. 이 서비스는 <b>이미지 바이트를 만지지 않는다</b> —
 * 크롭은 브라우저만 할 수 있는 일이고(영상 프레임이 거기 있다), 서버는 무엇이 언제 잡혔는지를 기록한다.
 *
 * <p><b>강사만 만든다.</b> 근거로 색인될 것이라 수강생이 넣을 수 있으면 안 된다.
 */
@Service
public class AnnotationHighlightService {

    private static final Logger log = LoggerFactory.getLogger(AnnotationHighlightService.class);

    /** 아직 AI로 보내지 않은 상태. 색인 연결(3단계)이 붙으면 여기서 출발한다. */
    public static final String STATUS_PENDING = "PENDING";

    private static final String KIND_ANNOTATION_SNAPSHOT = "ANNOTATION_SNAPSHOT";
    private static final String STATUS_UPLOADED = "UPLOADED";

    private final AnnotationHighlightRepository highlightRepository;
    private final LiveSessionRepository liveSessionRepository;
    private final LiveAccessGuard accessGuard;
    private final AssetDirectory assetDirectory;

    public AnnotationHighlightService(AnnotationHighlightRepository highlightRepository,
                                     LiveSessionRepository liveSessionRepository,
                                     LiveAccessGuard accessGuard,
                                     AssetDirectory assetDirectory) {
        this.highlightRepository = highlightRepository;
        this.liveSessionRepository = liveSessionRepository;
        this.accessGuard = accessGuard;
        this.assetDirectory = assetDirectory;
    }

    /**
     * 스냅샷을 남긴다.
     *
     * <p>{@code sessionMs}는 클라이언트가 주지 않고 <b>서버가 정한다.</b> 채팅과 같은 규칙이다 —
     * 클라이언트 시계를 믿으면 다시보기 앵커가 영상과 어긋나고, 그 어긋남은 나중에 근거를 눌렀을 때만
     * 드러난다.
     */
    @Transactional
    public AnnotationHighlight capture(UUID sessionId, UUID instructorId, UUID assetId, String interpretedText) {
        // 근거로 색인될 것이라 소유 강사만 만든다(수강생은 조회도 하지 않는다 — 아래 list 참고).
        accessGuard.requireOwner(sessionId, instructorId);
        LiveSession session = liveSessionRepository.findById(sessionId)
                .orElseThrow(() -> new LiveSessionNotFoundException("라이브 세션이 없습니다."));

        requireOwnUploadedSnapshotAsset(assetId, instructorId);

        AnnotationHighlight snapshot = new AnnotationHighlight();
        snapshot.setLiveSessionId(session.getId());
        snapshot.setLessonId(session.getLessonId());
        snapshot.setCurriculumId(session.getCurriculumId());
        snapshot.setAssetId(assetId);
        snapshot.setSessionMs(elapsedMs(session));
        snapshot.setInterpretedText(blankToNull(interpretedText));
        snapshot.setIndexStatus(STATUS_PENDING);

        AnnotationHighlight saved = highlightRepository.save(snapshot);
        log.info("강조 스냅샷 저장 sessionId={} highlightId={} sessionMs={}",
                sessionId, saved.getId(), saved.getSessionMs());
        return saved;
    }

    /** 강조 내역(강사용). 뺀 것은 담지 않는다. */
    @Transactional(readOnly = true)
    public List<AnnotationHighlight> list(UUID sessionId, UUID instructorId) {
        accessGuard.requireOwner(sessionId, instructorId);
        return highlightRepository.findByLiveSessionIdAndRemovedAtIsNullOrderBySessionMsAsc(sessionId);
    }

    /**
     * 근거에서 뺀다(소프트, 멱등).
     *
     * <p>지우개와는 무관하다 — 강조 스트로크를 지우는 것은 "슬라이드가 넘어가 화면과 안 맞는다"는
     * 뜻이지 "그 내용이 틀렸다"가 아니다. 이건 강사가 명시적으로 근거에서 빼는 동작이다.
     */
    @Transactional
    public void remove(UUID sessionId, UUID instructorId, UUID highlightId) {
        accessGuard.requireOwner(sessionId, instructorId);
        highlightRepository.findById(highlightId)
                .filter(snapshot -> snapshot.getLiveSessionId().equals(sessionId))
                .ifPresent(snapshot -> {
                    if (snapshot.getRemovedAt() == null) {
                        snapshot.setRemovedAt(OffsetDateTime.now());
                        log.info("강조 스냅샷 제외 sessionId={} highlightId={}", sessionId, highlightId);
                    }
                });
    }

    /**
     * 남의 에셋이나 엉뚱한 종류를 스냅샷으로 붙이지 못하게 막는다. 업로드가 끝나지 않은 에셋도 거절한다 —
     * 나중에 AI가 읽으러 갔을 때 빈 객체를 만나면 원인을 찾기 어렵다.
     */
    private void requireOwnUploadedSnapshotAsset(UUID assetId, UUID instructorId) {
        AssetRef asset = assetDirectory.find(assetId)
                .orElseThrow(() -> new AnnotationHighlightValidationException("에셋을 찾을 수 없습니다."));
        if (!instructorId.equals(asset.uploadedBy())) {
            throw new AnnotationHighlightValidationException("본인이 올린 이미지만 사용할 수 있습니다.");
        }
        if (!KIND_ANNOTATION_SNAPSHOT.equals(asset.kind())) {
            throw new AnnotationHighlightValidationException("강조 스냅샷 이미지가 아닙니다.");
        }
        if (!STATUS_UPLOADED.equals(asset.status())) {
            throw new AnnotationHighlightValidationException("업로드가 끝나지 않은 이미지입니다.");
        }
    }

    /** 라이브 시작(clock_origin_at) 기준 경과 ms. 아직 시작 전이면 0 — 채팅과 같은 규칙이다. */
    private long elapsedMs(LiveSession session) {
        if (session.getClockOriginAt() == null) {
            return 0L;
        }
        return Math.max(0L, Duration.between(session.getClockOriginAt(), OffsetDateTime.now()).toMillis());
    }

    private String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }
}
