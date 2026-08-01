package com.liveclass.auth.service;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/** 관리자 allowlist 판별(대소문자 무시·공백/빈값 처리). ROLE_ADMIN 오버레이의 판정 근거다. */
class AdminAccountsTest {

    @Test
    void empty_config_grants_no_admin() {
        AdminAccounts accounts = new AdminAccounts("");
        assertThat(accounts.isAdmin("a@b.com")).isFalse();
    }

    @Test
    void listed_email_is_admin_case_insensitive() {
        AdminAccounts accounts = new AdminAccounts(" Admin@Ex.com , other@x.com ");
        assertThat(accounts.isAdmin("admin@ex.com")).isTrue();
        assertThat(accounts.isAdmin("ADMIN@EX.COM")).isTrue();
        assertThat(accounts.isAdmin("other@x.com")).isTrue();
    }

    @Test
    void unlisted_or_null_is_not_admin() {
        AdminAccounts accounts = new AdminAccounts("admin@ex.com");
        assertThat(accounts.isAdmin("nope@x.com")).isFalse();
        assertThat(accounts.isAdmin(null)).isFalse();
    }
}
