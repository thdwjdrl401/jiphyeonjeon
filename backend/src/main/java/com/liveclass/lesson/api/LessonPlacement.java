package com.liveclass.lesson.api;

import java.util.UUID;

/**
 * 레슨 재배치 지시(구조 순서 저장용). 레슨을 어느 섹션의 몇 번째에 둘지만 담는다.
 * 섹션이 같은 커리큘럼에 속하는지 등 소유권·범위 검증은 호출자(curriculum) 책임이다 — lesson 모듈은
 * curriculum을 모른다(순환 금지).
 */
public record LessonPlacement(

        UUID lessonId,
        UUID sectionId,
        int orderIndex
) {
}
