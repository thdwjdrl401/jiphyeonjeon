package com.liveclass.lesson.api;

/**
 * 같은 (레슨, 에셋) 자료가 이미 활성 연결돼 있음 → 409. DDL에 유니크 제약이 없어 앱에서 막는다.
 * 경계(api) 예외라 curriculum 등 호출 모듈이 매핑할 수 있다.
 */
public class MaterialAlreadyAttachedException extends RuntimeException {
    public MaterialAlreadyAttachedException(String message) {
        super(message);
    }
}
