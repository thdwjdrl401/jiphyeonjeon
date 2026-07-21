package com.liveclass.auth.service;

/** 유효하지 않은 프로필 이미지 에셋 참조(없음·타인 소유·잘못된 종류·미완료) → 400. */
public class ProfileImageInvalidException extends RuntimeException {
    public ProfileImageInvalidException(String message) {
        super(message);
    }
}
