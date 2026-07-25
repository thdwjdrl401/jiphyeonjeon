package com.liveclass.lesson.api;

/**
 * 연결하려는 에셋이 유효하지 않음(없음·kind가 MATERIAL 아님·업로드 미완료·업로더 불일치) → 400.
 * 경계(api) 예외라 curriculum 등 호출 모듈이 매핑할 수 있다.
 */
public class MaterialAssetInvalidException extends RuntimeException {
    public MaterialAssetInvalidException(String message) {
        super(message);
    }
}
