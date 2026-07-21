package com.liveclass.asset.service;

/** 잘못된 업로드 요청(허용되지 않는 content-type·크기 초과 등) → 400. */
public class AssetValidationException extends RuntimeException {
    public AssetValidationException(String message) {
        super(message);
    }
}
