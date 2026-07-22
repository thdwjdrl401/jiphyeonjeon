package com.liveclass.asset.service;

import com.liveclass.asset.config.AssetReaperProperties;
import com.liveclass.asset.domain.Asset;
import com.liveclass.asset.domain.AssetStatus;
import com.liveclass.asset.repository.AssetRepository;
import com.liveclass.common.logging.Audit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * 미완료 에셋 회수. 티켓만 받고 완료 통지를 하지 않은 PENDING 행은 그냥 두면 영원히 남는다
 * (스토리지에 반쯤 올라간 객체도 함께). 만료 기준보다 오래된 PENDING을 주기적으로 FAILED로 내리고,
 * 남은 객체는 best-effort로 지운다.
 *
 * <p>행을 지우지 않고 FAILED로 두는 이유는 감사 추적 때문이다 — "언제 무엇이 업로드되다 말았는지"가 남는다.
 * 전이는 PENDING → FAILED 뿐이라 여러 인스턴스가 동시에 돌아도, 몇 번을 다시 돌아도 안전하다(멱등).
 */
@Component
public class AssetReaper {

    private static final Logger log = LoggerFactory.getLogger(AssetReaper.class);

    private final AssetRepository assetRepository;
    private final AssetStorage storage;
    private final AssetReaperProperties props;

    public AssetReaper(AssetRepository assetRepository, AssetStorage storage, AssetReaperProperties props) {
        this.assetRepository = assetRepository;
        this.storage = storage;
        this.props = props;
    }

    /**
     * 만료된 PENDING 에셋을 FAILED로 회수하고 회수 건수를 돌려준다.
     * 스케줄러가 부르지만 테스트·운영 점검에서 직접 호출해도 되게 public·반환값을 둔다.
     *
     * @return 이번 실행에서 FAILED로 내린 에셋 수
     */
    @Scheduled(
            fixedDelayString = "${asset.reaper.fixed-delay:PT1H}",
            initialDelayString = "${asset.reaper.initial-delay:PT5M}")
    @Transactional
    public int reapExpiredPendingAssets() {
        OffsetDateTime threshold = OffsetDateTime.now().minusHours(props.getPendingExpiryHours());
        List<Asset> expired = assetRepository.findByStatusAndCreatedAtBefore(AssetStatus.PENDING, threshold);
        if (expired.isEmpty()) {
            return 0;
        }

        int reaped = 0;
        for (Asset asset : expired) {
            // 조회 이후 완료 통지가 끼어들었을 수 있다 — PENDING이 아니면 건드리지 않는다.
            if (asset.getStatus() != AssetStatus.PENDING) {
                continue;
            }
            deleteObjectQuietly(asset);
            asset.setStatus(AssetStatus.FAILED);
            reaped++;
        }

        log.info(Audit.MARKER, "미완료 에셋 회수 count={} olderThan={}", reaped, threshold);
        return reaped;
    }

    /** 스토리지 정리는 부가 작업이다 — 실패해도 회수(FAILED 전이) 자체를 깨뜨리지 않는다. */
    private void deleteObjectQuietly(Asset asset) {
        try {
            storage.delete(asset.getObjectKey());
        } catch (RuntimeException e) {
            log.warn("미완료 에셋 객체 삭제 실패(무시) assetId={} objectKey={}",
                    asset.getId(), asset.getObjectKey(), e);
        }
    }
}
