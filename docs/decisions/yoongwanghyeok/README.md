# 윤광혁 — 프론트엔드 기획·API 결정 기록

> 정본 규칙: [AGENTS.md](../../../AGENTS.md) · 아키텍처: [ARCHITECTURE.md](../../ARCHITECTURE.md) · 공유 계약: [CONTRACT.md](../../CONTRACT.md)

- **기록 기준일**: 2026-07-23
- **범위**: 이번 세션에서 진행한 페이지 분리, 컴포넌트 명세, 라이브·VOD 정책, 프론트 API 협의, 전체 페이지 구현 과정의 런타임·라우팅·fixture·공통 자료·사용자 이동 구조 결정
- **목적**: 채택된 제품·프론트 결정을 다시 찾을 수 있게 하고, 현재 정본과 충돌하거나 아직 검증되지 않은 항목을 분리한다.

## 문서 우선순위

이 디렉토리는 세션 의사결정의 이력이며 공유 계약의 정본이 아니다. 내용이 충돌하면 다음 순서로 판단한다.

1. 루트 `AGENTS.md`, `docs/CONTRACT.md`, `docs/ARCHITECTURE.md`
2. 더 최근에 채택된 팀 ADR, 특히 `docs/decisions/songjeongki/`
3. 이 디렉토리의 채택 ADR
4. `docs/frontend/`의 제안·협의 필요 명세

따라서 이 기록의 제품 목표가 현재 MVP 결정과 다르면 현재 MVP ADR을 먼저 적용하고, 차이는 [이슈·트러블슈팅 로그](OPEN_ISSUES_AND_TROUBLESHOOTING.md)에서 추적한다.

## 결정 문서

| 문서 | 상태 | 요약 |
|---|---|---|
| [0001](0001-frontend-specification-decomposition.md) | 채택 | 페이지 → 컴포넌트 → API 순서와 문서 분리 방식 |
| [0002](0002-curriculum-roles-and-access-composition.md) | 채택 | 커리큘럼→섹션→레슨, 강사·학생·수강생, 관계별 UI |
| [0003](0003-lesson-pptx-incremental-processing.md) | 제품 목표 채택 | PPTX 전용, 초기 복수 업로드와 이후 단일 증분 처리 |
| [0004](0004-live-media-rewind-and-permissions.md) | 제품 목표 채택 | LiveKit 현재 라이브 + Egress HLS 되감기, 수강생 수신 전용 |
| [0005](0005-question-insights-and-synchronized-replay.md) | 제품 목표 채택 | 질문 체크·익명 질문 핀·시간 동기화 채팅 리플레이 |
| [0006](0006-vod-publication-review-and-learning.md) | 제품 목표 채택 | VOD·AI 게시 분리, 강사 검수, 진도·퀴즈 정책 |
| [0007](0007-frontend-api-negotiation-specs.md) | 채택 | 백엔드 협의용 API 문서의 분리·표기·공통 원칙 |
| [0008](0008-frontend-runtime-and-data-source-boundary.md) | 채택 | 독립 Vite 서버와 `VITE_USE_MOCK_API` 단일 데이터 소스 경계 |
| [0009](0009-role-prefixed-routing-and-entry-gates.md) | 채택 | 학생·강사 prefix 상위 가드와 라이브 prejoin 강제 |
| [0010](0010-integrated-mock-domain-state.md) | 부분 대체됨 | 통합 fixture 원칙은 유지하고 수강 레코드 소유권은 0017로 분리 |
| [0011](0011-optional-curriculum-materials.md) | 프론트 채택 | 선택형 커리큘럼 공통 자료와 수강·소유 관계 기반 노출 |
| [0012](0012-curriculum-centered-navigation-and-lesson-live-management.md) | 프론트 채택 | 커리큘럼 중심 탐색과 레슨 중심 라이브 일정·상세 통합 |
| [0013](0013-profile-image-edit-modal.md) | 프론트 채택 | 프로필 이미지 편집 모달과 구현된 계약만 저장하는 원칙 |
| [0014](0014-operation-level-hybrid-api-routing.md) | 대체됨 | 함수별 API 구현 메타데이터와 `VITE_USE_MOCK_API` 하이브리드 분기 |
| [0015](0015-feature-service-adapter-routing.md) | 채택 | feature 인터페이스 구현체 단위의 전체 mock/HTTP 전환 |
| [0016](0016-enrollment-reapplication-and-immediate-policy.md) | 채택 | 종료 상태의 동일 레코드 재신청과 IMMEDIATE 소비 경로 유지 |
| [0017](0017-independent-enrollment-feature-boundary.md) | 채택 | 수강 API·상태·훅을 독립 feature 경계로 통합 |
| [0018](0018-centralized-frontend-test-directory.md) | 채택 | 프론트 테스트를 `src/test` 아래에서 책임별로 중앙 관리 |

## 이슈와 트러블슈팅

[OPEN_ISSUES_AND_TROUBLESHOOTING.md](OPEN_ISSUES_AND_TROUBLESHOOTING.md)에 다음을 구분해 기록한다.

- 해결됨: 문서 비대화, 브랜치 오작업, 용어·파일 형식 변경 이력, LiveKit 되감기 오해, API prefix 변경, 화면별 mock 상태 불일치, 병합 충돌
- 조율 필요: 레슨 발행 MVP 편차, 커리큘럼 공통 자료의 백엔드 계약·AI 영향 범위
- 구현 전 검증: 녹화 중 누적 DVR HLS, session clock 보정, 검수 동시성, 진행률 계산

## 관련 산출물

- 페이지: [PAGES.md](../../frontend/PAGES.md)
- 컴포넌트: [components/README.md](../../frontend/components/README.md)
- API 공통: [api/API_MAP.md](../../frontend/api/API_MAP.md)
- 미확정 항목: [DECISIONS_PENDING.md](../../frontend/DECISIONS_PENDING.md)
- 구현·실행 기준: [IMPLEMENTATION_GUIDE.md](../../frontend/IMPLEMENTATION_GUIDE.md)
- 상태 전이: [STATE_TRANSITIONS.md](../../STATE_TRANSITIONS.md)
