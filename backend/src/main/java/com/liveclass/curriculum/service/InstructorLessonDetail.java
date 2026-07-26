package com.liveclass.curriculum.service;

import com.liveclass.lesson.api.LessonView;
import com.liveclass.lesson.api.MaterialView;

import java.util.List;

/**
 * 강사 레슨 단건 상세 = 레슨 + 연결된 활성 자료(ADR-0035). 강사 수정 폼이 저장된 자료를 다시
 * 보여주려면 관리 GET이 materials까지 줘야 한다({@link LessonView}에는 materials가 없기 때문).
 */
public record InstructorLessonDetail(LessonView lesson, List<MaterialView> materials) {
}
