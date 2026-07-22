package com.liveclass.curriculum.web;

/**
 * 목록 API의 페이지 파라미터 정규화(공통). size의 상·하한뿐 아니라 <b>page의 상한</b>도 잡는다.
 *
 * <p>page 상한이 없으면 Spring Data가 계산하는 오프셋({@code page * size})이 int 범위를 넘어
 * {@code InvalidDataAccessApiUsageException} → 500이 된다. 사용자가 보낸 쿼리 파라미터 하나로
 * 500이 나면 안 되므로, 범위를 넘는 page는 "그 size에서 가능한 마지막 페이지"로 잘라 빈 목록을 준다.
 */
final class PageParams {

    static final int DEFAULT_SIZE = 20;
    static final int MAX_SIZE = 100;

    private PageParams() {
    }

    /** 0 이하는 기본값, 상한은 MAX_SIZE. */
    static int size(int requested) {
        if (requested <= 0) {
            return DEFAULT_SIZE;
        }
        return Math.min(requested, MAX_SIZE);
    }

    /** 하한 0, 상한은 offset이 int를 넘지 않는 최대 페이지. size는 {@link #size(int)}로 정규화한 값을 넘긴다. */
    static int page(int requested, int size) {
        int bounded = Math.max(0, requested);
        int maxPage = Integer.MAX_VALUE / Math.max(1, size) - 1;
        return Math.min(bounded, maxPage);
    }
}
