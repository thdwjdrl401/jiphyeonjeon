package com.liveclass.auth.service;

/** 강사 전용 리소스(공개 프로필)에 강사가 아닌 사용자가 접근 → 403. */
public class InstructorOnlyException extends RuntimeException {
    public InstructorOnlyException(String message) {
        super(message);
    }
}
