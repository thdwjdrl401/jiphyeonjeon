package com.liveclass.learning.service;

import com.liveclass.common.logging.Audit;
import com.liveclass.learning.api.LessonLearningAccess;
import com.liveclass.learning.domain.LearningProgress;
import com.liveclass.learning.repository.LearningProgressRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 학습 진도. 진도율은 클라이언트가 계산해 보내고 서버는 저장·검증한다(ADR-0033) — VOD
 * 재생이라 브라우저가 재생 위치를 안다. 서버는 두 가지 방어만 얹는다.
 *
 * <ul>
 *   <li><b>순서역전 방어</b>: clientUpdatedAt 이 저장값보다 뒤일 때만 반영한다(진도 후퇴 방지, DDL 설계).</li>
 *   <li><b>완료 sticky</b>: 진도율이 임계(90%)를 넘으면 completedAt 을 한 번 찍고, 이후엔 유지한다.</li>
 * </ul>
 *
 * <p>watched_ranges 기반의 정교한 유효시청량 판정은 이번 범위 밖이다 — 클라가 계산한 progressPercent 를 신뢰한다.
 */
@Service
public class LearningService {

    private static final Logger log = LoggerFactory.getLogger(LearningService.class);
    /** 완료로 치는 진도율 임계. DDL 주석(90% 돌파)과 같다. */
    private static final int COMPLETION_THRESHOLD_PERCENT = 90;

    private final LearningProgressRepository progressRepository;
    private final LessonLearningAccess access;

    public LearningService(LearningProgressRepository progressRepository,
                           LessonLearningAccess access) {
        this.progressRepository = progressRepository;
        this.access = access;
    }

    /**
     * 진도 갱신(upsert). 없으면 만들고 있으면 덮는다 — user·lesson 당 한 행(uq).
     * clientUpdatedAt 이 저장값보다 뒤가 아니면 오래된 업데이트로 보고 무시한다.
     */
    @Transactional
    public LearningProgress updateProgress(UUID userId, UUID lessonId, int progressPercent,
                                           long lastPositionMs, OffsetDateTime clientUpdatedAt) {
        access.ensureCanLearn(userId, lessonId);
        int clamped = Math.max(0, Math.min(100, progressPercent));

        LearningProgress progress = progressRepository.findByUserIdAndLessonId(userId, lessonId)
                .orElseGet(() -> {
                    LearningProgress created = new LearningProgress();
                    created.setUserId(userId);
                    created.setLessonId(lessonId);
                    return created;
                });

        // 순서역전 방어: 새 clientUpdatedAt 이 저장값보다 뒤일 때만 반영한다. 둘 다 있을 때만 판정하고,
        // 저장값이 없으면(첫 저장) 그대로 반영한다.
        if (progress.getClientUpdatedAt() != null && clientUpdatedAt != null
                && !clientUpdatedAt.isAfter(progress.getClientUpdatedAt())) {
            return progress;
        }

        progress.setProgressPercent(clamped);
        progress.setLastPositionMs(lastPositionMs);
        if (clientUpdatedAt != null) {
            progress.setClientUpdatedAt(clientUpdatedAt);
        }
        // 완료는 sticky — 임계를 한 번 넘으면 그때 시각을 남기고, 이후 진도율이 내려가도 유지한다.
        if (clamped >= COMPLETION_THRESHOLD_PERCENT && progress.getCompletedAt() == null) {
            progress.setCompletedAt(OffsetDateTime.now());
        }
        LearningProgress saved = progressRepository.save(progress);
        log.info(Audit.MARKER, "진도 갱신 userId={} lessonId={} percent={}", userId, lessonId, clamped);
        return saved;
    }

    /** 레슨 학습 컨텍스트 — 내 진도(없으면 null). */
    @Transactional(readOnly = true)
    public LearningContext getLearningContext(UUID userId, UUID lessonId) {
        access.ensureCanLearn(userId, lessonId);
        LearningProgress progress = progressRepository.findByUserIdAndLessonId(userId, lessonId).orElse(null);
        return new LearningContext(lessonId, progress);
    }

    /** getLearningContext 결과 묶음(웹 계층 DTO 변환용). */
    public record LearningContext(UUID lessonId, LearningProgress progress) {
    }
}
