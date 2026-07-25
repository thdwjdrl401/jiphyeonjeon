package com.liveclass.curriculum.service;

import java.util.List;

/**
 * 이 사용자가 이 커리큘럼과 맺은 관계와, 그래서 지금 할 수 있는 일.
 * FE는 이걸로 주 CTA를 고른다 — 화면이 역할·수강상태를 다시 조합하지 않도록 서버가 한 번에 답한다.
 */
public record CatalogViewerContext(
        String relationship,
        List<String> allowedActions,
        CatalogEnrollmentRecord enrollment,
        CatalogProgress progress
) {
    public static CatalogViewerContext of(String relationship, List<String> allowedActions) {
        return new CatalogViewerContext(relationship, allowedActions, null, null);
    }

    public static CatalogViewerContext of(String relationship, List<String> allowedActions,
                                          CatalogEnrollmentRecord enrollment) {
        return new CatalogViewerContext(relationship, allowedActions, enrollment, null);
    }

    /** 진도를 얹은 새 컨텍스트. record라 불변이므로 새 인스턴스로 돌려준다(수강자에게만 채운다). */
    public CatalogViewerContext withProgress(CatalogProgress progress) {
        return new CatalogViewerContext(relationship, allowedActions, enrollment, progress);
    }
}
