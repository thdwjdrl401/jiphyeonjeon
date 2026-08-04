package com.liveclass.live.service;

/** 스냅샷으로 붙일 수 없는 에셋(없음·남의 것·다른 종류·업로드 미완) → 400. */
public class AnnotationHighlightValidationException extends RuntimeException {

    public AnnotationHighlightValidationException(String message) {
        super(message);
    }
}
