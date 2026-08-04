package com.liveclass.asset.service;

import com.liveclass.asset.api.AssetUploadException;

/** 에셋이 없음 → 404. */
public class AssetNotFoundException extends AssetUploadException {
    public AssetNotFoundException(String message) {
        super(Reason.NOT_FOUND, message);
    }
}
