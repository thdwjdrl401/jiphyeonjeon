package com.liveclass.curriculum.service;

/**
 * 이 레슨을 지금 열 수 있는가, 열면 어디로 가는가.
 * 막혔을 때만 reasonCode가 차고, 열릴 때만 destination이 찬다.
 */
public record CatalogLessonAccess(
        boolean allowed,
        String destination,
        String reasonCode
) {
    public static CatalogLessonAccess blocked(String reasonCode) {
        return new CatalogLessonAccess(false, null, reasonCode);
    }

    public static CatalogLessonAccess open(String destination) {
        return new CatalogLessonAccess(true, destination, null);
    }
}
