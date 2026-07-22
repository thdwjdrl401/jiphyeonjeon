package com.liveclass.curriculum.service;

import java.util.List;
import java.util.UUID;

/** 카탈로그가 조립한 강사 요약(서비스 결과). 웹 DTO 변환은 컨트롤러가 한다. */
public record CatalogInstructor(

        UUID instructorId,
        String displayName,
        String bio,
        List<String> expertise
) {
}
