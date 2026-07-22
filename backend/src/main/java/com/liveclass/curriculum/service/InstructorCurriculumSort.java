package com.liveclass.curriculum.service;

import org.springframework.data.domain.Sort;

/**
 * 강사 운영 목록 정렬(MY-CURRICULUM-02). 지원하지 않는 값은 무시하지 않고 400으로 거절한다
 * (enum 변환 실패 → VALIDATION_FAILED). CatalogSort와 같은 규칙.
 *
 * <p><b>NEXT_SESSION은 의도적으로 없다.</b> 계약 초안이 제안한 "다음 세션 시각 순" 정렬은
 * curriculum × live 두 모듈에 걸친 정렬이라 지금 포트(live.api 배치 조회)로는 표현할 수 없다.
 * 페이지를 자른 뒤 그 안에서만 재정렬하면 전역 순서가 아니라 조용히 틀린 결과가 되므로,
 * 값을 받아들이지 않고 400을 돌려줘 FE가 미구현임을 즉시 알 수 있게 한다.
 *
 * <p>모든 정렬에 <b>id 2차 키</b>가 붙는다. createdAt·title은 값이 겹칠 수 있고(같은 밀리초 생성,
 * 동명 커리큘럼), 1차 키만으로는 DB가 페이지마다 다른 순서를 골라도 되므로 같은 행이 1페이지와
 * 2페이지에 동시에 나오거나 아예 빠질 수 있다. 페이징의 전제인 전순서를 id로 확정한다.
 */
public enum InstructorCurriculumSort {

    LATEST(Sort.by(Sort.Order.desc("createdAt"), Sort.Order.asc("id"))),
    TITLE_ASC(Sort.by(Sort.Order.asc("title"), Sort.Order.asc("id")));

    private final Sort sort;

    InstructorCurriculumSort(Sort sort) {
        this.sort = sort;
    }

    public Sort toSort() {
        return sort;
    }
}
