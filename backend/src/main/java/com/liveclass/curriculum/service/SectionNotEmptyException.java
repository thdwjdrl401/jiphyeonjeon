package com.liveclass.curriculum.service;

public class SectionNotEmptyException extends RuntimeException {

    public SectionNotEmptyException(String message) {
        super(message);
    }
}
