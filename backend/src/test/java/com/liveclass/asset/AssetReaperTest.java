package com.liveclass.asset;

import com.liveclass.asset.domain.Asset;
import com.liveclass.asset.domain.AssetKind;
import com.liveclass.asset.domain.AssetStatus;
import com.liveclass.asset.repository.AssetRepository;
import com.liveclass.asset.service.AssetReaper;
import com.liveclass.asset.service.AssetStorage;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

/**
 * 미완료 에셋 회수(AssetReaper) 검증. 스케줄을 기다리지 않고 빈 메서드를 직접 호출한다.
 * created_at은 @CreationTimestamp가 소유해 JPA로는 못 바꾸므로 JdbcTemplate으로 과거 시각을 심는다.
 * 스토리지는 모킹해 실제 MinIO 없이 돈다.
 */
@SpringBootTest
@Transactional
class AssetReaperTest {

    @Autowired
    private AssetReaper reaper;

    @Autowired
    private AssetRepository assetRepository;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @PersistenceContext
    private EntityManager entityManager;

    @MockitoBean
    private AssetStorage storage;

    @Test
    void reaps_only_stale_pending_assets() {
        OffsetDateTime longAgo = OffsetDateTime.now().minusDays(3);
        UUID stalePending = givenAsset(AssetStatus.PENDING, longAgo);
        UUID freshPending = givenAsset(AssetStatus.PENDING, OffsetDateTime.now());
        UUID staleUploaded = givenAsset(AssetStatus.UPLOADED, longAgo);
        String staleKey = objectKeyOf(stalePending);

        flushAndClear();
        int reaped = reaper.reapExpiredPendingAssets();

        // 다른 테스트가 남긴 행이 섞일 수 있으므로 총량이 아니라 대상별 상태로 확인한다.
        assertThat(reaped).isGreaterThanOrEqualTo(1);
        assertThat(statusOf(stalePending)).isEqualTo(AssetStatus.FAILED);
        assertThat(statusOf(freshPending)).isEqualTo(AssetStatus.PENDING);
        assertThat(statusOf(staleUploaded)).isEqualTo(AssetStatus.UPLOADED);

        // 만료된 에셋의 잔여 객체만 정리한다.
        verify(storage).delete(staleKey);
        verify(storage, never()).delete(objectKeyOf(freshPending));
        verify(storage, never()).delete(objectKeyOf(staleUploaded));
    }

    @Test
    void second_run_leaves_already_reaped_assets_alone() {
        UUID stalePending = givenAsset(AssetStatus.PENDING, OffsetDateTime.now().minusDays(3));
        String staleKey = objectKeyOf(stalePending);

        flushAndClear();
        reaper.reapExpiredPendingAssets();
        flushAndClear();
        reaper.reapExpiredPendingAssets();

        assertThat(statusOf(stalePending)).isEqualTo(AssetStatus.FAILED);
        verify(storage, times(1)).delete(staleKey);   // 이미 FAILED인 행은 다시 걸리지 않는다
    }

    @Test
    void storage_failure_does_not_block_the_transition() {
        UUID stalePending = givenAsset(AssetStatus.PENDING, OffsetDateTime.now().minusDays(3));
        doThrow(new IllegalStateException("스토리지 장애")).when(storage).delete(objectKeyOf(stalePending));

        flushAndClear();
        int reaped = reaper.reapExpiredPendingAssets();

        assertThat(reaped).isGreaterThanOrEqualTo(1);
        assertThat(statusOf(stalePending)).isEqualTo(AssetStatus.FAILED);
    }

    // ---- 헬퍼 ----

    /** 주어진 상태·생성시각의 에셋을 한 건 만든다(uploaded_by는 nullable이라 유저 없이도 된다). */
    private UUID givenAsset(AssetStatus status, OffsetDateTime createdAt) {
        Asset asset = new Asset();
        asset.setKind(AssetKind.PROFILE_IMAGE);
        asset.setBucket("liveclass-assets-test");
        asset.setObjectKey("profile_image/" + UUID.randomUUID());
        asset.setOriginalFilename("avatar.png");
        asset.setContentType("image/png");
        asset.setSizeBytes(1024L);
        asset.setStatus(status);
        UUID id = assetRepository.saveAndFlush(asset).getId();
        jdbcTemplate.update("update core.asset set created_at = ? where id = ?", createdAt, id);
        return id;
    }

    private AssetStatus statusOf(UUID assetId) {
        return assetRepository.findById(assetId).orElseThrow().getStatus();
    }

    private String objectKeyOf(UUID assetId) {
        return assetRepository.findById(assetId).orElseThrow().getObjectKey();
    }

    /**
     * 회수 실행 사이의 경계를 흉내 낸다. 운영에선 실행마다 트랜잭션이 커밋되지만 테스트는 한 트랜잭션 안이라,
     * flush로 전이를 DB에 반영한 뒤 clear로 1차 캐시를 비워야 다음 조회가 DB 상태를 그대로 읽는다
     * (clear만 하면 아직 flush되지 않은 변경이 그냥 버려진다).
     */
    private void flushAndClear() {
        entityManager.flush();
        entityManager.clear();
    }
}
