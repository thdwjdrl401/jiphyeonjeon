package com.liveclass.notification.service;

/**
 * 없는 알림, 또는 <b>남의 알림</b>.
 *
 * <p>둘을 구별하지 않는다. 남의 알림에 403을 주면 "그 알림이 존재한다"는 사실이 새기 때문이다
 * (CONTRACT §2-4). 조회·갱신 쿼리가 {@code recipient_id}를 조건에 넣으므로, 남의 것은 자연히
 * 0행이 되어 이 예외로 떨어진다.
 */
public class NotificationNotFoundException extends RuntimeException {

    public NotificationNotFoundException(String message) {
        super(message);
    }
}
