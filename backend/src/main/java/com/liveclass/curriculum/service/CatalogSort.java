package com.liveclass.curriculum.service;

import org.springframework.data.domain.Sort;

/** 공개 목록 정렬. 지원하지 않는 값은 잘못된 요청으로 400 처리한다(무시하지 않는다). */
public enum CatalogSort {

    LATEST(Sort.by(Sort.Direction.DESC, "createdAt")),
    TITLE_ASC(Sort.by(Sort.Direction.ASC, "title"));

    private final Sort sort;

    CatalogSort(Sort sort) {
        this.sort = sort;
    }

    public Sort toSort() {
        return sort;
    }
}
