package com.liveclass.auth.service;

public class EmailDuplicatedException extends RuntimeException {

    public EmailDuplicatedException(String message) {
        super(message);
    }
}
