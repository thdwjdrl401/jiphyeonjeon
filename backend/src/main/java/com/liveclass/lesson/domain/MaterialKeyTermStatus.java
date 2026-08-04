package com.liveclass.lesson.domain;

/**
 * PPTX 핵심 용어 추출 상태(ADR-0010). 임베딩 상태와 독립적으로 전이한다.
 */
public enum MaterialKeyTermStatus {
    NOT_REQUESTED,
    PENDING,
    PROCESSING,
    READY,
    EMPTY,
    FAILED;

    /**
     * 한 번 확정된 terminal 결과가 지연·충돌 callback으로 되돌아가지 않게 한다.
     * 재처리는 별도 명령과 전용 reset 전이로 새 실행을 시작해야 한다.
     */
    public boolean canTransitionTo(MaterialKeyTermStatus target) {
        if (this == target) {
            return true;
        }
        return switch (this) {
            case NOT_REQUESTED -> target == PENDING;
            case PENDING -> target == PROCESSING || target.isTerminal();
            case PROCESSING -> target.isTerminal();
            case READY, EMPTY, FAILED -> false;
        };
    }

    private boolean isTerminal() {
        return this == READY || this == EMPTY || this == FAILED;
    }
}
