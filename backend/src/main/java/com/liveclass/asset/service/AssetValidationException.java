package com.liveclass.asset.service;

import com.liveclass.asset.api.AssetUploadException;

/** 잘못된 업로드 요청(허용되지 않는 content-type·크기 초과 등) → 400. */
public class AssetValidationException extends AssetUploadException {
    public AssetValidationException(String message) {
        super(Reason.INVALID, message);
    }
}
