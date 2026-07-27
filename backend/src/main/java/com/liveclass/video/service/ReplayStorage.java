package com.liveclass.video.service;

import java.time.Duration;
import java.util.Optional;

/**
 * 다시보기 매니페스트 서빙 포트(ADR-0039, ARCHITECTURE §9-8). webhook 검증용 {@link RecordingStorage}와
 * 나눠, 재생에 필요한 두 동작만 둔다: 매니페스트 텍스트 읽기와 세그먼트 presigned GET URL 발급.
 *
 * <p>원칙 4 — 세그먼트 바이트는 앱 서버를 통과하지 않는다. 서버는 수 KB짜리 매니페스트 텍스트만
 * 만지고, 세그먼트 URI를 presigned URL로 재작성해 클라이언트가 스토리지에서 직접 받게 한다.
 */
public interface ReplayStorage {

    /** 매니페스트 본문(UTF-8). 객체 부재가 확정된 404는 empty, 그 밖의 스토리지 오류는 예외다. */
    Optional<String> findManifest(String bucket, String key);

    /** 부재를 예외로 다루는 기존 호출자를 위한 편의 메서드. */
    default String readManifest(String bucket, String key) {
        return findManifest(bucket, key)
                .orElseThrow(() -> new ReplayManifestMissingException("매니페스트를 찾을 수 없습니다: " + key));
    }

    /** 세그먼트(또는 임의 객체) presigned GET URL을 발급한다 — presign은 로컬 서명이라 네트워크 접속이 없다. */
    String presignSegment(String bucket, String key, Duration ttl);
}
