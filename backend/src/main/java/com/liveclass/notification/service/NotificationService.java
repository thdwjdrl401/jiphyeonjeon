package com.liveclass.notification.service;

import com.liveclass.notification.api.NewNotification;
import com.liveclass.notification.domain.Notification;
import com.liveclass.notification.repository.NotificationInsertRepository;
import com.liveclass.notification.repository.NotificationRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.UUID;

import static com.liveclass.notification.domain.NotificationStatus.ACTION_REQUIRED;
import static com.liveclass.notification.domain.NotificationStatus.UNREAD;

/**
 * 알림 조회와 읽음 처리(CONTRACT §2-4).
 *
 * <p><b>인가를 따로 하지 않는다.</b> 모든 쿼리가 {@code recipientId}를 조건으로 갖는다 — 남의
 * 알림은 조회되지도 갱신되지도 않아 그대로 404가 된다. 소유자를 읽어 비교하는 단계가 없으므로
 * 확인과 갱신 사이에 끼어들 틈도 없다.
 */
@Service
@Transactional(readOnly = true)
public class NotificationService {

    private final NotificationRepository repository;
    private final NotificationInsertRepository insertRepository;

    public NotificationService(NotificationRepository repository,
                               NotificationInsertRepository insertRepository) {
        this.repository = repository;
        this.insertRepository = insertRepository;
    }

    /**
     * 내 알림 목록.
     *
     * @param scope     {@code ACTION_REQUIRED}면 처리 대기만. null이면 처리 축으로 가리지 않는다
     * @param readState {@code UNREAD}·{@code READ}. null이면 읽음 축으로 가리지 않는다
     */
    public NotificationPage list(UUID recipientId, String scope, String readState, int page, int size) {
        String actionStatus = "ACTION_REQUIRED".equals(scope) ? ACTION_REQUIRED : null;
        Page<Notification> found = repository.findMine(
                recipientId, actionStatus, readState, PageRequest.of(page, size));
        // 개수는 필터와 무관한 전체 기준이다 — 목록과 같은 응답에 담아야 "모두 읽음" 직후
        // 목록은 비었는데 배지만 남는 어긋남이 생기지 않는다.
        return new NotificationPage(found, summary(recipientId));
    }

    /**
     * 배지 개수. <b>필터와 무관한 전체 기준</b>이다.
     *
     * <p>두 개수를 한 문장에 묶지 않는 것은 부분 인덱스를 쓰기 위해서다 — {@code FILTER}로 묶으면
     * 그 사람의 알림을 전부 훑는다. 화면이 60초마다 물어보는 값이라 이 차이가 쌓인다.
     */
    public NotificationSummary summary(UUID recipientId) {
        return new NotificationSummary(
                repository.countByRecipientIdAndReadStatus(recipientId, UNREAD),
                repository.countByRecipientIdAndActionStatus(recipientId, ACTION_REQUIRED));
    }

    /**
     * 개별 읽음. <b>처리 축을 건드리지 않는다</b> — 강사가 수강 신청 알림을 읽어도 승인 전까지
     * 할 일로 남아야 한다.
     *
     * <p>이미 읽은 알림을 다시 눌러도 오류가 아니다(멱등). 갱신 0행과 "없는 알림"을 구별하기 위해
     * 갱신 뒤 한 번 더 읽는다.
     */
    @Transactional
    public Notification markRead(UUID recipientId, UUID notificationId) {
        repository.markRead(notificationId, recipientId);
        return repository.findByIdAndRecipientId(notificationId, recipientId)
                .orElseThrow(() -> new NotificationNotFoundException("알림을 찾을 수 없습니다."));
    }

    /** 모두 읽음. 갱신 뒤의 개수를 돌려준다 — 화면이 배지를 즉시 0으로 맞출 수 있어야 한다. */
    @Transactional
    public NotificationSummary markAllRead(UUID recipientId) {
        repository.markAllRead(recipientId);
        return summary(recipientId);
    }

    /**
     * 알림을 만든다. 2단계부터 이벤트 리스너·팬아웃 워커가 부른다.
     *
     * <p>같은 사건이 두 번 와도 한 건만 남는다({@code ON CONFLICT DO NOTHING}). 중복은 오류가
     * 아니므로 예외를 던지지 않고 <b>들어간 행 수</b>를 돌려준다.
     */
    @Transactional
    public int create(Collection<NewNotification> notifications) {
        return insertRepository.insertAll(notifications);
    }
}
