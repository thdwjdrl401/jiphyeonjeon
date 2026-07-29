package com.liveclass.live.domain;

/** 시작 시도의 진행 상태(ADR-0002 §2·§6). 세션당 IN_PROGRESS는 최대 하나(부분 유니크 인덱스). */
public enum LiveStartAttemptStatus {
    IN_PROGRESS,
    SUCCEEDED,
    FAILED
}
