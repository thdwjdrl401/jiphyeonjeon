package com.liveclass.aiintegration.web;

/** AI 콜백 서명 검증 실패 → 401. aiintegration web 소유 예외(공용 500 핸들러가 먼저 잡지 않게). */
public class AiCallbackUnverifiedException extends RuntimeException {

    public AiCallbackUnverifiedException(String message) {
        super(message);
    }
}
