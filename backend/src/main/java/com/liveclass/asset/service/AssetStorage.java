package com.liveclass.asset.service;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.Optional;

/**
 * 스토리지 추상화(seam). 실 구현은 S3AssetStorage(MinIO/S3), 테스트는 모킹한다 — 그래서 계약
 * 테스트가 실제 MinIO 없이 돈다. presign은 서명만 계산하므로 스토리지에 접속하지 않는다.
 */
public interface AssetStorage {

    /**
     * 이 객체키로 바이트를 올릴 presigned PUT URL을 만든다(만료시각 포함).
     * contentLength를 서명에 포함해 클라이언트가 선언한 크기만큼만 올릴 수 있게 한다(초과 업로드 차단).
     */
    PresignedUpload presignUpload(String objectKey, String contentType, long contentLength, Duration ttl);

    /** 이 객체를 읽을 presigned GET URL을 만든다. */
    String presignDownload(String objectKey, Duration ttl);

    /** 업로드된 객체의 실제 메타(크기·content-type). 없으면 empty — 업로드 완료·크기·형식 검증용. */
    Optional<StoredObject> head(String objectKey);

    /**
     * 이 객체를 지운다. 객체가 없어도 성공으로 취급한다(S3 DELETE 자체가 멱등).
     * 미완료(PENDING) 에셋 회수 시 남은 바이트를 치우는 용도 — 호출측은 실패를 삼킨다.
     */
    void delete(String objectKey);

    /** presigned 업로드 발급 결과. */
    record PresignedUpload(String url, OffsetDateTime expiresAt) {
    }

    /** 스토리지에 실제로 올라온 객체의 메타. */
    record StoredObject(long contentLength, String contentType) {
    }
}
