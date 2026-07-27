package com.liveclass.video.service;

import java.time.Duration;

/**
 * 다시보기 매니페스트 서빙 포트(ADR-0039, ARCHITECTURE §9-8). webhook 검증용 {@link RecordingStorage}와
 * 나눠, 재생에 필요한 두 동작만 둔다: 매니페스트 텍스트 읽기와 세그먼트 presigned GET URL 발급.
 *
 * <p>원칙 4 — 세그먼트 바이트는 앱 서버를 통과하지 않는다. 서버는 수 KB짜리 매니페스트 텍스트만
 * 만지고, 세그먼트 URI를 presigned URL로 재작성해 클라이언트가 스토리지에서 직접 받게 한다.
 */
public interface ReplayStorage {

    /**
     * 매니페스트 본문(UTF-8). 객체가 없으면 {@link ReplayManifestMissingException}을 던진다 —
     * 호출자가 자산 READY로 존재를 먼저 보장하지만, {@code retention_until} 만료 등으로 스토리지에서
     * 파일만 먼저 사라지는 엣지케이스가 실제로 있어 이 경로에서도 404를 확정 신호로 다룬다.
     */
    String readManifest(String bucket, String key);

    /** 세그먼트(또는 임의 객체) presigned GET URL을 발급한다 — presign은 로컬 서명이라 네트워크 접속이 없다. */
    String presignSegment(String bucket, String key, Duration ttl);
}
