package com.liveclass.curriculum.service;

import java.util.List;
import java.util.UUID;

/**
 * 구조 순서 저장 요청의 섹션 한 칸. 배열 위치가 섹션 순서, lessonIds의 위치가 레슨 순서다.
 * 레슨은 같은 커리큘럼 안이라면 다른 섹션으로 옮겨 담을 수 있다(DDL 주석: "같은 커리큘럼 안에서만 이동").
 */
public record SectionOrderCommand(

        UUID sectionId,
        List<UUID> lessonIds
) {
}
