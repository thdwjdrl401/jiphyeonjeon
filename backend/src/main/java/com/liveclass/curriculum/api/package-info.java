/**
 * curriculum 모듈이 다른 모듈에 공개하는 포트와 경계 DTO. 이 패키지만 외부 접근 가능하고
 * domain·repository·service는 내부로 감춘다(모듈 경계).
 */
@org.springframework.modulith.NamedInterface("api")
package com.liveclass.curriculum.api;
