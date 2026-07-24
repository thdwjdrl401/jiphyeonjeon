package com.liveclass.live.service;

import com.liveclass.auth.api.AccountWithdrawalGuard;
import com.liveclass.auth.api.WithdrawalBlockedException;
import com.liveclass.live.domain.LiveSessionStatus;
import com.liveclass.live.repository.LiveSessionRepository;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.Set;
import java.util.UUID;

/**
 * 진행 중인 라이브를 소유한 강사는 탈퇴할 수 없다.
 *
 * <p>auth가 선언한 {@link AccountWithdrawalGuard}를 live가 구현한다 — 진행 상태는 live만 안다.
 * 의존 방향은 live → auth 로, 기존 경계와 같다(auth는 live를 참조하지 않는다).
 *
 * <p>막는 상태는 <b>실제로 켜져 있는</b> STARTING·LIVE·ENDING만이다. SCHEDULED·OPEN은 아직
 * 시작 전이라 취소하고 탈퇴할 수 있고, ENDED·CANCELLED·FAILED는 이미 끝났다.
 */
@Component
public class LiveWithdrawalGuard implements AccountWithdrawalGuard {

    private static final Set<LiveSessionStatus> IN_PROGRESS =
            Set.of(LiveSessionStatus.STARTING, LiveSessionStatus.LIVE, LiveSessionStatus.ENDING);

    private final LiveSessionRepository liveSessionRepository;

    public LiveWithdrawalGuard(LiveSessionRepository liveSessionRepository) {
        this.liveSessionRepository = liveSessionRepository;
    }

    @Override
    @Transactional(readOnly = true)
    public void ensureCanWithdraw(UUID userId) {
        if (liveSessionRepository.existsByInstructorIdAndStatusIn(userId, IN_PROGRESS)) {
            throw new WithdrawalBlockedException("진행 중인 라이브 강의가 있어 탈퇴할 수 없습니다. 강의를 종료한 뒤 다시 시도해 주세요.");
        }
    }
}
