package com.liveclass.asset.service;

/** 에셋의 소유자(업로더)가 아님 → 403. */
public class AssetForbiddenException extends RuntimeException {
    public AssetForbiddenException(String message) {
        super(message);
    }
}
