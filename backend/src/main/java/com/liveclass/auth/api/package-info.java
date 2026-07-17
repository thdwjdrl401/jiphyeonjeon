/**
 * auth 모듈이 다른 모듈에 공개하는 인터페이스(포트)와 경계 DTO. 이 패키지만 외부에서 접근 가능하고
 * domain·repository·service는 내부로 감춰진다(모듈 경계).
 */
@org.springframework.modulith.NamedInterface("api")
package com.liveclass.auth.api;
