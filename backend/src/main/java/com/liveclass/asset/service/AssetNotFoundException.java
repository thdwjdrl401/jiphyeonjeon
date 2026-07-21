package com.liveclass.asset.service;

/** 에셋이 없음 → 404. */
public class AssetNotFoundException extends RuntimeException {
    public AssetNotFoundException(String message) {
        super(message);
    }
}
