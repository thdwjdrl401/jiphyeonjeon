package com.liveclass.video.web;

/**
 * webhook 서명·본문 해시 검증 실패 → 401. LiveKit이 아닌 호출이거나 본문이 변조됐다.
 * video web 계층이 소유해 자체 예외 핸들러가 401로 매핑한다(공용 Exception 핸들러의 500을 피한다).
 */
public class WebhookVerificationException extends RuntimeException {
    public WebhookVerificationException(String message) {
        super(message);
    }

    public WebhookVerificationException(String message, Throwable cause) {
        super(message, cause);
    }
}
