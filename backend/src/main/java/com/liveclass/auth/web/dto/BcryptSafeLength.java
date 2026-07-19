package com.liveclass.auth.web.dto;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * BCrypt는 72바이트를 넘는 입력을 거부하며 예외를 던진다(자르지 않는다).
 * {@code @Size}는 바이트가 아니라 문자를 세므로 한글 비밀번호를 통과시킨 뒤 인코딩 단계에서 터진다
 * — 한글 1자 = UTF-8 3바이트라 25자면 75바이트다.
 */
@Documented
@Constraint(validatedBy = BcryptSafeLengthValidator.class)
@Target({ElementType.FIELD, ElementType.PARAMETER, ElementType.RECORD_COMPONENT})
@Retention(RetentionPolicy.RUNTIME)
public @interface BcryptSafeLength {

    String message() default "비밀번호가 너무 깁니다.";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

    int maxBytes() default 72;
}
