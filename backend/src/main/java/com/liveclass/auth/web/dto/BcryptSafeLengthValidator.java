package com.liveclass.auth.web.dto;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

import java.nio.charset.StandardCharsets;

public class BcryptSafeLengthValidator implements ConstraintValidator<BcryptSafeLength, String> {

    private int maxBytes;

    @Override
    public void initialize(BcryptSafeLength constraint) {
        this.maxBytes = constraint.maxBytes();
    }

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        // null·공백 여부는 @NotBlank의 몫이다.
        return value == null || value.getBytes(StandardCharsets.UTF_8).length <= maxBytes;
    }
}
