package com.liveclass.auth.web.dto;

import com.liveclass.auth.domain.Role;

/** 가입 경로로 만들 수 있는 역할만 노출한다. OPERATOR는 별도 경로(app_user.role 코멘트). */
public enum SignupRole {

    STUDENT,
    INSTRUCTOR;

    public Role toRole() {
        return Role.valueOf(name());
    }
}
