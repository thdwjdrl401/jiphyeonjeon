package com.liveclass.asset.api;

import java.util.Collection;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * 에셋 조회·URL 해석 포트. 다른 모듈은 이걸로만 에셋을 참조한다(asset 엔티티·리포지토리 비접근).
 * 커리큘럼 썸네일·프로필 이미지가 소비한다: find로 소유/종류/상태를 검증하고, resolveUrl(s)로
 * 표시용 presigned GET URL을 얻는다.
 */
public interface AssetDirectory {

    /** 에셋 참조(소유자·종류·상태). 없으면 empty. */
    Optional<AssetRef> find(UUID assetId);

    /**
     * assetId → 에셋 참조 배치 조회(N+1 회피). 레슨 자료 목록처럼 여러 에셋의 파일명·크기를
     * 한 번에 채워야 할 때 쓴다. 없는 id는 결과에서 빠진다.
     */
    Map<UUID, AssetRef> findRefs(Collection<UUID> assetIds);

    /**
     * assetId → presigned GET URL 배치 해석. UPLOADED가 아니거나 없는 id는 결과에서 빠진다
     * (목록 응답의 N+1 회피용).
     */
    Map<UUID, String> resolveUrls(Collection<UUID> assetIds);

    /** 단건 URL 해석. UPLOADED가 아니거나 없으면 empty. */
    Optional<String> resolveUrl(UUID assetId);
}
