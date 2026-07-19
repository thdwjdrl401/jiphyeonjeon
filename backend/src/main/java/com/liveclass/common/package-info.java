/**
 * 공유 커널. 오류 봉투·예외 핸들러·보안/문서 설정·감사 로깅 규약 등 모든 모듈이 공유하는
 * 횡단 기반이다. OPEN 모듈로 열어 하위 패키지를 자유롭게 참조할 수 있게 한다 — 이건 경계 위반이
 * 아니라 공유 커널의 의도된 성격이다.
 */
@org.springframework.modulith.ApplicationModule(type = org.springframework.modulith.ApplicationModule.Type.OPEN)
package com.liveclass.common;
