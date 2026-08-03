package com.liveclass.notification.service;

import com.liveclass.notification.domain.Notification;
import org.springframework.data.domain.Page;

/**
 * 목록 한 쪽과 <b>전체 기준 개수</b>. 둘을 한 응답에 담는 이유는 "모두 읽음" 직후 목록은 비었는데
 * 배지만 남는 어긋남을 없애기 위해서다.
 */
public record NotificationPage(Page<Notification> page, NotificationSummary summary) {
}
