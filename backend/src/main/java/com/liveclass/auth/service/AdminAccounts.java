package com.liveclass.auth.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.Arrays;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 관리자(ADMIN) 계정 판별 — 별도 Role/회원가입 흐름 없이 config 이메일 allowlist로 오버레이한다.
 * {@code security.admin-emails}(콤마 구분)에 든 이메일이면 로그인 시 {@code ROLE_ADMIN}을 추가로 부여한다
 * ({@code AuthController}). 목록이 비면(기본) 관리자는 없다.
 *
 * <p>운영 도구(예: Egress 관리 콘솔) 게이팅용이다. 계정 자체는 기존 STUDENT/INSTRUCTOR로 두고, 여기에
 * 든 이메일에만 관리 권한을 덧입힌다 — DB·signup 변경 없이 개발/운영에서 관리자를 지정할 수 있다.
 * 목록을 바꾸면 해당 사용자는 <b>재로그인</b>해야 권한이 반영된다(권한은 로그인 시 세션에 고정).
 */
@Component
public class AdminAccounts {

    private final Set<String> emails;

    public AdminAccounts(@Value("${security.admin-emails:}") String csv) {
        this.emails = Arrays.stream(csv.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .map(s -> s.toLowerCase(Locale.ROOT))
                .collect(Collectors.toUnmodifiableSet());
    }

    public boolean isAdmin(String email) {
        return email != null && emails.contains(email.toLowerCase(Locale.ROOT));
    }
}
