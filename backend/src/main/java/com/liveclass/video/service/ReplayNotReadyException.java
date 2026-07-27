package com.liveclass.video.service;

/**
 * 다시보기 자산이 아직 재생 가능한 상태(READY)가 아니다 → 409. 녹화가 진행·확정 중이거나(RECORDING·
 * FINALIZING·VERIFYING) 실패(FAILED)면 매니페스트를 서빙할 수 없다. 존재는 하지만 지금은 재생 불가라
 * 404(부재)가 아니라 409(상태 충돌)로 가른다 — live 세션 상태 충돌과 같은 계열.
 */
public class ReplayNotReadyException extends RuntimeException {
    public ReplayNotReadyException(String message) {
        super(message);
    }
}
