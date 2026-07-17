package com.liveclass.curriculum.service;

public class NotCurriculumOwnerException extends RuntimeException {

    public NotCurriculumOwnerException(String message) {
        super(message);
    }
}
