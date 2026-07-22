package com.liveclass.curriculum.service;

/**
 * 구조 순서 저장 요청이 커리큘럼의 현재 구조와 정확히 대응하지 않음(누락·중복·외부 ID) → 400.
 * 전체 요청을 실패시키며 어떤 것도 부분 적용하지 않는다(CURRICULUM_MANAGEMENT.md §7).
 */
public class StructureInvalidException extends RuntimeException {
    public StructureInvalidException(String message) {
        super(message);
    }
}
