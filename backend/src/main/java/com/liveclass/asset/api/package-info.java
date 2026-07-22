/**
 * asset 모듈이 다른 모듈에 공개하는 포트와 경계 DTO. 이 패키지만 외부 접근 가능하고
 * domain·repository·service·config는 내부로 감춘다(모듈 경계). 소비자는 assetId(UUID)로만
 * 에셋을 참조하고, 소유자·종류·상태 검증과 URL 해석은 이 포트로 얻는다.
 */
@org.springframework.modulith.NamedInterface("api")
package com.liveclass.asset.api;
