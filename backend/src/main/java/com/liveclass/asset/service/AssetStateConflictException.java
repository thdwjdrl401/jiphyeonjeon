package com.liveclass.asset.service;

/**
 * 에셋 상태가 요청과 충돌 → 409. 완료 통지가 왔는데 스토리지에 바이트가 아직 없어 업로드를
 * 확인할 수 없는 경우에 쓴다(400 잘못된 요청과 구분 — 재시도 가능한 충돌).
 */
public class AssetStateConflictException extends RuntimeException {
    public AssetStateConflictException(String message) {
        super(message);
    }
}
