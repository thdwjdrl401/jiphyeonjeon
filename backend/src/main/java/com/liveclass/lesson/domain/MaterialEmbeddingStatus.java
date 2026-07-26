package com.liveclass.lesson.domain;

/**
 * 자료 임베딩 파이프라인 상태(ADR-0036). 연결 상태({@link MaterialStatus} ACTIVE/DELETED)와 직교한다.
 * PENDING(잡 대기) → PROCESSING(AI 처리 중) → READY(pgvector 적재 완료) / FAILED.
 */
public enum MaterialEmbeddingStatus {
    PENDING,
    PROCESSING,
    READY,
    FAILED
}
