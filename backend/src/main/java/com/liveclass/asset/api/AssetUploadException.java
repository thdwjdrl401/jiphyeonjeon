package com.liveclass.asset.api;

/** asset 내부 구현을 노출하지 않고 도메인 전용 업로드 호출자에게 실패 종류만 전달한다. */
public class AssetUploadException extends RuntimeException {

    private final Reason reason;

    public AssetUploadException(Reason reason, String message) {
        super(message);
        this.reason = reason;
    }

    public Reason reason() {
        return reason;
    }

    public enum Reason {
        NOT_FOUND,
        FORBIDDEN,
        STATE_CONFLICT,
        INVALID
    }
}
