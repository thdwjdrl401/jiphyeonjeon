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
 *   <li><b>순서역전 방어</b>: clientUpdatedAt 이 저장값보다 뒤일 때만 반영한다(DDL 설계). 이것은
 *       <b>늦게 도착한 옛 보고</b>를 막을 뿐, 새 보고가 들고 온 낮은 값은 막지 못한다.</li>
 *   <li><b>진도는 내려가지 않는다</b>: 저장값과 새 값 중 큰 쪽을 남긴다(ADR-0116).</li>
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

        /*
         * <b>진도는 내려가지 않는다.</b> 순서역전 방어는 늦게 온 옛 보고만 막는다 — 방금 만들어진
         * 보고가 낮은 값을 들고 오면 그대로 덮였다. 운영에서 23칸(92%)을 본 학생이 다시보기를 잠깐
         * 열었다가 4%로 기록됐다(클라가 캐시 때문에 빈 상태에서 시작했다). 그쪽 원인은 따로 고쳤지만,
         * 진도는 사람이 들인 시간이라 한 번 오른 것이 클라이언트 사정으로 깎이면 안 된다.
         *
         * <p>대가를 안다: 자료를 다시 올려 길이가 <b>늘어나면</b> 같은 칸 수의 비율이 낮아지는데,
         * 그때도 옛 값이 남아 과대평가된다. 진도가 사라지는 쪽이 강사·학생 모두에게 더 나쁘다고 보고
         * 이쪽을 택했다. 되돌리려면 재업로드 시점에 명시적으로 초기화하는 편이 맞다.
         */
        // 새로 만든 행은 기본 0이지만 Integer라 null 가능성을 닫아 둔다.
        int stored = progress.getProgressPercent() == null ? 0 : progress.getProgressPercent();
        int effective = Math.max(clamped, stored);
        progress.setProgressPercent(effective);
        // 위치는 최대값이 아니다 — "지금 어디를 보고 있나"라 마지막 값이 맞다(이어보기가 이걸 쓴다).
        progress.setLastPositionMs(lastPositionMs);
        if (clientUpdatedAt != null) {
            progress.setClientUpdatedAt(clientUpdatedAt);
        }
        // 완료는 sticky — 임계를 한 번 넘으면 그때 시각을 남기고, 이후 진도율이 내려가도 유지한다.
        if (effective >= COMPLETION_THRESHOLD_PERCENT && progress.getCompletedAt() == null) {
            progress.setCompletedAt(OffsetDateTime.now());
        }
        LearningProgress saved = progressRepository.save(progress);
        log.info(Audit.MARKER, "진도 갱신 userId={} lessonId={} percent={} 보고값={}",
                userId, lessonId, effective, clamped);
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
