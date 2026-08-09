package com.liveclass.learning.service;

import com.liveclass.common.logging.Audit;
import com.liveclass.learning.api.WatchProgressSettlement;
import com.liveclass.learning.repository.LearningProgressRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * {@link WatchProgressSettlement} 구현. 계산 규칙은 화면(`bucketProgressPercent`)과 같아야 한다.
 *
 * <p>예전에는 이 환산을 <b>학생 브라우저만</b> 했다 — 다시보기 화면을 열면 그때 쌓인 칸을 물려받아
 * 계산했다. 그래서 끝까지 듣고 열지 않은 학생은 0%로 남았고, "실시간으로 다 들었는데 왜 0%냐"가 됐다.
 * 녹화가 없는 강의에서는 영영 0%였다.
 */
@Service
public class WatchProgressSettlementImpl implements WatchProgressSettlement {

    private static final Logger log = LoggerFactory.getLogger(WatchProgressSettlementImpl.class);

    private final LearningProgressRepository progressRepository;

    public WatchProgressSettlementImpl(LearningProgressRepository progressRepository) {
        this.progressRepository = progressRepository;
    }

    /*
     * 부르는 쪽이 커밋 뒤 리스너라 트랜잭션이 닫혀 있다. 새로 열지 않으면 아래 쓰기에 경계가 없다.
     */
    @Override
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void settleFromRecording(UUID lessonId, Long durationMs) {
        if (durationMs == null || durationMs <= 0) {
            // 길이를 모르면 분모가 없다. 예전과 같은 상태로 둘 뿐 잘못 계산하지 않는다.
            log.info("녹화 길이를 몰라 진도 환산을 건너뛴다 lessonId={}", lessonId);
            return;
        }
        int totalBuckets = totalBuckets(durationMs);
        int settled = progressRepository.settleProgressFromWatchBuckets(
                lessonId, totalBuckets, LearningService.COMPLETION_THRESHOLD_PERCENT);
        if (settled > 0) {
            log.info(Audit.MARKER, "라이브 시청분 진도 환산 lessonId={} 전체칸={} 대상={}",
                    lessonId, totalBuckets, settled);
        }
    }

    /**
     * 전체 칸 수. 화면의 {@code bucketProgressPercent}와 <b>같은 식이어야</b> 한다 — 다르면 같은 시청이
     * 화면과 서버에서 다른 비율로 보인다.
     */
    public static int totalBuckets(long durationMs) {
        return (int) Math.max(1, Math.ceilDiv(durationMs, WatchHeatmapService.BUCKET_SIZE_MS));
    }
}
