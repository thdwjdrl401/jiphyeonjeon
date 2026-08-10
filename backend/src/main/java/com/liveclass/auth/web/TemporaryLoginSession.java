package com.liveclass.auth.web;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;

/**
 * 이번 로그인이 임시 비밀번호로 이루어졌는지를 세션에 적어 두고 읽는다.
 *
 * <p><b>계정이 아니라 세션의 성질이다.</b> 같은 계정이라도 원래 비밀번호로 들어오면 바꿀 이유가
 * 없고, 임시 비밀번호로 들어오면 반드시 바꿔야 한다. 계정 행에 두면 원래 비밀번호로 들어온
 * 사람까지 변경 화면에 갇힌다.
 *
 * <p>인증 응답을 만드는 곳이 여럿이라(로그인·내 정보·프로필 수정) 한 곳에 모은다 — 한 군데서만
 * 읽으면 나머지 응답이 <b>false를 실어 보내 화면의 게이트를 풀어 버린다</b>.
 */
final class TemporaryLoginSession {

    static final String ATTRIBUTE = "liveclass.signedInWithTemporaryPassword";

    private TemporaryLoginSession() {
    }

    static void mark(HttpServletRequest request, boolean usedTemporaryPassword) {
        request.getSession().setAttribute(ATTRIBUTE, usedTemporaryPassword);
    }

    /** 세션이 없거나 표시가 없으면 원래 비밀번호로 들어온 것으로 본다. */
    static boolean isSignedInWithTemporaryPassword(HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        return session != null && Boolean.TRUE.equals(session.getAttribute(ATTRIBUTE));
    }
}
