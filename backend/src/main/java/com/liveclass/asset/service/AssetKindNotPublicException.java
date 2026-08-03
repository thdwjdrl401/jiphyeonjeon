package com.liveclass.asset.service;

/** 내부 도메인 전용 asset kind를 generic 외부 API로 요청했을 때 발생한다. */
public class AssetKindNotPublicException extends RuntimeException {

    public AssetKindNotPublicException(String message) {
        super(message);
    }
}
