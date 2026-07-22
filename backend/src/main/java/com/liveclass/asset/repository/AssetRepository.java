package com.liveclass.asset.repository;

import com.liveclass.asset.domain.Asset;
import com.liveclass.asset.domain.AssetStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public interface AssetRepository extends JpaRepository<Asset, UUID> {

    /**
     * 특정 상태로 이 시각 이전에 만들어진 에셋. 미완료(PENDING) 에셋 회수(AssetReaper)에서 쓴다 —
     * 상태를 조건에 넣었으므로 이미 회수된 행은 다음 실행에서 다시 잡히지 않는다(멱등).
     */
    List<Asset> findByStatusAndCreatedAtBefore(AssetStatus status, OffsetDateTime createdBefore);
}
