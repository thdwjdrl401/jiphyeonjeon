package com.liveclass.asset.service;

import com.liveclass.asset.api.AssetUploadException;

/** 에셋의 소유자(업로더)가 아님 → 403. */
public class AssetForbiddenException extends AssetUploadException {
    public AssetForbiddenException(String message) {
        super(Reason.FORBIDDEN, message);
    }
}
