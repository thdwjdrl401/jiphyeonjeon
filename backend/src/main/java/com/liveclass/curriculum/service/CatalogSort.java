package com.liveclass.curriculum.service;

import org.springframework.data.domain.Sort;

/**
 * 공개 목록 정렬. 지원하지 않는 값은 잘못된 요청으로 400 처리한다(무시하지 않는다).
 *
 * <p>TITLE_ASC는 같은 제목이 있더라도 페이지 경계에서 행이 중복되거나 빠지지 않도록 id를
 * 2차 키로 사용한다. 언어별 순서는 DB의 {@code core.curriculum.title}에 선언한
 * {@code core.ko_kr} ICU 콜레이션이 담당한다.
 */
public enum CatalogSort {

    LATEST(Sort.by(Sort.Direction.DESC, "createdAt")),
    TITLE_ASC(Sort.by(Sort.Order.asc("title"), Sort.Order.asc("id")));

    private final Sort sort;

    CatalogSort(Sort sort) {
        this.sort = sort;
    }

    public Sort toSort() {
        return sort;
    }
}
