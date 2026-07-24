package com.liveclass.auth.service;

import java.util.List;

/** 강사 공개 프로필(소개·전문분야) 조회·수정 결과. 아직 저장된 적 없으면 빈 값으로 온다. */
public record InstructorProfileView(String bio, List<String> expertise) {
}
