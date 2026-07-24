package com.liveclass.auth.api;

/**
 * 지금은 탈퇴할 수 없다(진행 중인 라이브 세션 등). 존재는 정상이고 상태가 막는 것이라 409로 답한다.
 *
 * <p>auth.api가 소유하므로 auth의 예외 핸들러가 매핑할 수 있다 — 구현 모듈(live)의 예외 타입을
 * auth가 참조하면 순환이 되기 때문이다.
 */
public class WithdrawalBlockedException extends RuntimeException {

    public WithdrawalBlockedException(String message) {
        super(message);
    }
}
