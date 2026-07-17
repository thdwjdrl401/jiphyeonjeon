package com.liveclass.curriculum.service;

/** 현재 lifecycle 상태에서 허용되지 않는 전이(예: 이미 발행됨을 또 발행). FE 계약 코드 CURRICULUM_STATE_CONFLICT. */
public class CurriculumStateConflictException extends RuntimeException {

    public CurriculumStateConflictException(String message) {
        super(message);
    }
}
