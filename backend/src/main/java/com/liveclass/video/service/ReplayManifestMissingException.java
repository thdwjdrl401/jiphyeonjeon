package com.liveclass.video.service;

/**
 * 매니페스트 객체가 스토리지에 없다(404). {@link ReplayStorage#readManifest}가 던지고
 * {@link ReplayPlaybackService}가 409 {@code REPLAY_NOT_READY}로 옮긴다.
 *
 * <p>자산이 READY라고 기록돼 있어도 실제 파일이 사라졌을 수 있다 — {@code retention_until} 만료로
 * 스토리지 쪽에서 먼저 정리되는 경우가 실제 엣지케이스다. webhook VERIFYING의 HEAD 확인은 완료
 * 시점 1회뿐이라 그 뒤의 삭제까지는 못 잡으므로, 재생 시점에도 방어가 필요하다.
 */
public class ReplayManifestMissingException extends RuntimeException {
    public ReplayManifestMissingException(String message) {
        super(message);
    }
}
