package com.liveclass.live.service;

/** 판서 해석을 마치지 못했다. 강사 화면에 "다시 시도"를 띄우는 경우다(ADR-0054). */
public class AnnotationInterpretException extends RuntimeException {

    public AnnotationInterpretException(String message) {
        super(message);
    }

    public AnnotationInterpretException(String message, Throwable cause) {
        super(message, cause);
    }
}
