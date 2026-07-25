package com.liveclass.asset.api;

import java.util.UUID;

/**
 * asset 모듈이 외부에 노출하는 경계 DTO. 소비자(curriculum·auth)가 asset 내부(엔티티)를 건드리지 않고
 * 소유권·종류·상태를 검증할 수 있게 한다. kind·status는 enum 이름 문자열이다(경계에서 enum 비노출).
 * fileName·sizeBytes는 자료(MATERIAL) 연결 응답이 원본 파일명·크기를 그대로 실어 보내는 데 쓴다.
 */
public record AssetRef(
        UUID assetId,
        String kind,
        String status,
        UUID uploadedBy,
        String fileName,
        long sizeBytes
) {
}
