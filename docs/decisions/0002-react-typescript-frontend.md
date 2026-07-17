# ADR-0002: 프론트엔드를 React + TypeScript로 전환

> 📍 하네스 개요: [../harness/README.md](../harness/README.md) · 판단 정책: [../harness/POLICY.md](../harness/POLICY.md)

- **상태**: 채택 (배포 방식 일부 개정 — 아래 개정 이력 참조)
- **일자**: 2026-07-13
- **관련**: 프론트엔드 스켈레톤 전환, ADR-0001, ADR-0014

> **개정 이력 (2026-07-16)**: 본 ADR의 "Vite 산출물을 `backend/src/main/resources/dist`에 넣어 Spring Boot가 8080에서 SPA+API를 함께 서빙"하는 **단일 서버 통합 배포** 결정은 이후 폐기되었다. 현재 아키텍처는 **FE(Vite dev 8083)/BE(Spring 8080) 분리 오리진**이며, 프론트가 API 경로를 8080으로 프록시한다(통합 포트 서빙 없음). 배포 구조는 [ADR-0015](0015-docker-deploy-fe-be-nginx.md), API 경로 규약은 [ADR-0016](0016-drop-api-path-versioning.md)를 정본으로 한다 — [ADR-0014](0014-auth-redis-session-cookie.md), [RUN.md](../../RUN.md). 아래 §결정 18번째 항목과 §근거의 통합-배포 서술은 이 이력으로 대체된다. React+TypeScript+Context 전환이라는 본 ADR의 핵심 결정은 유효하다.

## 맥락

기존 Vue 3 스켈레톤을 React로 전환하되 `/api/v1` 계약과 Spring Boot 단일 서버 배포 방식을 유지해야 한다. 현재 전역 상태는 로그인 토큰과 활성 메뉴 정도이며, 화면 대부분은 네이티브 HTML/CSS로 구성되어 있다.

## 결정

- React 18과 TypeScript를 사용하고 Vite 5·Node.js 20.18 제약을 유지한다.
- 전역 상태는 React Context와 hooks로 관리하고 별도 상태 라이브러리는 추가하지 않는다.
- Element Plus를 제거하고 기존 CSS·이미지·폰트를 React 컴포넌트에서 재사용한다.
- Vite 산출물을 `backend/src/main/resources/dist`에 생성하고 Gradle `processResources`에 연결해 Spring Boot가 SPA와 API를 8080에서 함께 제공한다.

## 근거

- 현재 상태 규모에는 Context API가 충분해 Redux 계열 도입 비용이 불필요하다.
- TypeScript 타입으로 향후 WebRTC·채팅·API DTO 확장 시 런타임 계약 오류를 줄일 수 있다.
- 기존 CSS를 유지하면 프레임워크 전환과 UI 재설계를 분리할 수 있다.
- 기존 Spring 정적 리소스 배포 경로를 유지하면 운영 토폴로지와 API URL을 바꿀 필요가 없다.

## 대안

| 대안 | 장점 | 단점 |
|---|---|---|
| React + TypeScript + Context (선택) | 타입 안정성, 적은 추가 의존성 | 초기 타입 작성 필요 |
| React + JavaScript | 전환 코드가 적음 | 향후 실시간 메시지·DTO 타입 안전성 부족 |
| Redux Toolkit 또는 Zustand | 상태 확장에 유리 | 현재 스켈레톤 대비 설정·런타임 의존성 증가 |
| MUI 또는 Ant Design | React UI 컴포넌트 제공 | 기존 화면 재설계와 번들 증가가 동반됨 |

## 영향·후속

- Vue·Vuex·Vue Router·Element Plus 의존성과 `.vue` 파일을 제거한다.
- React Router, Vitest, React Testing Library 기반 라우팅·인증·UI 테스트를 활성화한다.
- 로그인은 마일스톤 핵심 계약이므로 백엔드 MockMvc 계약 테스트로 200/401/404와 `accessToken`을 검증한다.
- API wire 계약은 변경하지 않으므로 `CONTRACT.md`는 수정하지 않는다.
