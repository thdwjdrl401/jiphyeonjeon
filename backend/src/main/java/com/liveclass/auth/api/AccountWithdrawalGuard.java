package com.liveclass.auth.api;

import java.util.UUID;

/**
 * 탈퇴를 막아야 하는 사정이 다른 모듈에 있을 때 쓰는 SPI 포트.
 *
 * <p>auth는 가장 아래 모듈이라(live·curriculum이 auth를 참조) live를 직접 참조하면 순환이 된다.
 * 그래서 "탈퇴해도 되는가"의 판정은 auth가 인터페이스로 선언하고, 사정을 아는 모듈(live)이
 * 구현한다. 의존 방향은 live → auth 로 유지된다.
 *
 * <p>구현체는 막을 사유가 있으면 {@link WithdrawalBlockedException}을 던진다. 여러 모듈이 각자
 * 구현할 수 있고(향후 확장), auth는 주입된 모든 가드를 차례로 물어본다.
 */
public interface AccountWithdrawalGuard {

    /** 이 사용자가 지금 탈퇴할 수 없으면 {@link WithdrawalBlockedException}을 던진다. */
    void ensureCanWithdraw(UUID userId);
}
