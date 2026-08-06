# 윤광혁 — 프론트엔드 기획·API 결정 기록

> 정본 규칙: [AGENTS.md](../../../AGENTS.md) · 아키텍처: [ARCHITECTURE.md](../../ARCHITECTURE.md) · 공유 계약: [CONTRACT.md](../../CONTRACT.md)

- **정리 기준일**: 2026-08-06
- **검토 기준**: `origin/master`의 계약·구현과 `fix/fe/live-page`의 ADR-0023
- **범위**: 페이지·컴포넌트·API 경계, 런타임·라우팅·fixture, 커리큘럼·자료·프로필, 라이브·다시보기·학습 UI, 알림과 채팅 표시 정책
- **목적**: 채택된 제품·프론트 결정을 다시 찾을 수 있게 하고, 현재 정본과 충돌하거나 아직 검증되지 않은 항목을 분리한다.

## 문서 우선순위

이 디렉토리는 세션 의사결정의 이력이며 공유 계약의 정본이 아니다. 내용이 충돌하면 다음 순서로 판단한다.

1. 루트 `AGENTS.md`, `docs/CONTRACT.md`, `docs/ARCHITECTURE.md`
2. 더 최근에 채택된 팀 ADR, 특히 `docs/decisions/songjeongki/`
3. 이 디렉토리의 채택 ADR
4. `docs/frontend/`의 제안·협의 필요 명세

따라서 이 기록의 제품 목표가 현재 MVP 결정과 다르면 현재 MVP ADR을 먼저 적용하고, 차이는 [이슈·트러블슈팅 로그](OPEN_ISSUES_AND_TROUBLESHOOTING.md)에서 추적한다.

## 2026-08-06 현재 요약

- 레슨에는 초안 상태가 없고 공개 축은 커리큘럼 lifecycle 하나다. PPTX 레슨·커리큘럼 자료 계약은 구현됐다.
- 학생 미디어는 HLS 단일 재생이며 `GET /api/lessons/{lessonId}/playback`이 라이브 되감기와 다시보기를 잇는다. LiveKit은 강사 송출·Egress·STT 입력에 사용한다.
- 라이브와 라이브 다시보기는 공통 4탭 학습 사이드바와 자막 도크를 실제 API·WS·SSE에 연결했다. 업로드 녹화강의는 가능한 `AI 질문 / 핵심 용어` 두 탭만 사용한다.
- 프로필은 이미지뿐 아니라 표시 이름·강사 소개/전문 분야·비밀번호·탈퇴까지 실제 API로 저장한다.
- 북마크는 제품·API·FE/BE·DB에서 제거했다. 익명 채팅 가명은 `fix/fe/live-page`에서 세션별 순번(`익명1`, `익명2`, …)으로 전환했다.

상태 표기는 다음처럼 읽는다.

- **채택**: 현재도 유효한 결정
- **부분 대체**: 핵심 일부는 유지하지만 최신 팀 ADR·계약이 일부를 바꿈
- **대체됨**: 현재 구현 판단에 사용하지 않고 후속 ADR을 따름
- **제품 목표/부분 구현**: 방향은 유효하지만 아직 전체 계약·구현이 끝나지 않음

## 결정 문서

| 문서 | 상태 | 요약 |
|---|---|---|
| [0001](0001-frontend-specification-decomposition.md) | 채택 | 페이지 → 컴포넌트 → API 순서와 문서 분리 방식 |
| [0002](0002-curriculum-roles-and-access-composition.md) | 채택·구현 | 커리큘럼→섹션→레슨, 관계 기반 UI, `curriculumId` |
| [0003](0003-lesson-pptx-incremental-processing.md) | 부분 대체 | PPTX 자료 연결은 구현, 레슨 발행·AI readiness 게이트는 폐기 |
| [0004](0004-live-media-rewind-and-permissions.md) | 부분 대체 | 강사 LiveKit 송출 + 학생 HLS 단일 재생으로 구체화 |
| [0005](0005-question-insights-and-synchronized-replay.md) | 부분 구현 | 질문 채팅·동기화 리플레이 구현, 강사용 질문 집계 후속 |
| [0006](0006-vod-publication-review-and-learning.md) | 부분 구현·부분 대체 | VOD/AI 게시 분리 유지, 업로드 녹화 추가·북마크 제거 |
| [0007](0007-frontend-api-negotiation-specs.md) | 채택 | 백엔드 협의용 API 문서의 분리·표기·공통 원칙 |
| [0008](0008-frontend-runtime-and-data-source-boundary.md) | 채택 | 독립 Vite 서버와 `VITE_USE_MOCK_API` 단일 데이터 소스 경계 |
| [0009](0009-role-prefixed-routing-and-entry-gates.md) | 채택 | 학생·강사 prefix 상위 가드와 라이브 prejoin/preflight |
| [0010](0010-integrated-mock-domain-state.md) | 부분 대체됨 | 통합 fixture 원칙은 유지하고 수강 레코드 소유권은 0017로 분리 |
| [0011](0011-optional-curriculum-materials.md) | 채택·FE/BE 구현 | 커리큘럼 공통 자료와 관계 기반 노출, AI worker scope 후속 |
| [0012](0012-curriculum-centered-navigation-and-lesson-live-management.md) | 채택·API 연동 | 커리큘럼 중심 탐색과 레슨 폼의 라이브 일정 UX |
| [0013](0013-profile-image-edit-modal.md) | 부분 대체 | 이미지 업로드 원칙 유지, 실제 프로필 필드·역할별 UI 확장 |
| [0014](0014-operation-level-hybrid-api-routing.md) | 대체됨 | 함수별 API 구현 메타데이터와 `VITE_USE_MOCK_API` 하이브리드 분기 |
| [0015](0015-feature-service-adapter-routing.md) | 채택 | feature 인터페이스 구현체 단위의 전체 mock/HTTP 전환 |
| [0016](0016-enrollment-reapplication-and-immediate-policy.md) | 채택 | 종료 상태의 동일 레코드 재신청과 IMMEDIATE 소비 경로 유지 |
| [0017](0017-independent-enrollment-feature-boundary.md) | 채택 | 수강 API·상태·훅을 독립 feature 경계로 통합 |
| [0018](0018-centralized-frontend-test-directory.md) | 채택 | 프론트 테스트를 `src/test` 아래에서 책임별로 중앙 관리 |
| [0019](0019-unified-learning-sidebar-and-caption-dock-preview.md) | 채택·주요 계약 구현 | 공통 학습 사이드바, 자막·노트·AI·용어 연결 |
| [0020](0020-student-live-dvr-playback-api.md) | 대체됨 | 세션별 초안을 레슨별 통합 playback 계약이 대체 |
| [0021](0021-modern-ink-monotone-curation-ui.md) | 채택 | 감도높은모던수묵화모노톤큐레이션 UI와 Paper/Ink 화면 모드 |
| [0022](0022-browser-push-permission-ux-policy.md) | 채택 | 사전 안내 후 동의로만 여는 브라우저 알림 권한 요청, 전체 알림 페이지 영구 설정 |
| [0023](0023-anonymous-chat-alias-is-sequential.md) | 채택·병합 전 | 익명 채팅 가명을 세션별 등장 순번으로 부여 |
| [0024](0024-remove-bookmark-feature.md) | 채택·구현 | 북마크를 제품·계약·FE/BE·DB에서 제거 |
| [0025](0025-glossary-review-modal-on-lesson-detail.md) | 채택·FE 구현 | 핵심 용어 검수를 강의 상세 모달로 제공, 기존 upsert API 재사용 |

## 이슈와 트러블슈팅

[OPEN_ISSUES_AND_TROUBLESHOOTING.md](OPEN_ISSUES_AND_TROUBLESHOOTING.md)에 다음을 구분해 기록한다.

- 현재 후속: 커리큘럼 scope 자료의 AI worker 소비, 강사용 질문 인사이트·검수·퀴즈, 장시간 HLS 운영 검증, 익명 순번의 프로세스 재시작 내구성
- 해결됨: 레슨 발행 축, 공통 자료 CRUD, 학생 재생 경로, 프로필 저장 범위, 북마크 제거, 상대 링크와 mock 상태 불일치
- 트러블슈팅 이력: 브랜치·staging·병합·샌드박스 빌드와 문서 분리 과정에서 재사용할 점검 절차

## 관련 산출물

- 페이지: [PAGES.md](../../frontend/PAGES.md)
- 컴포넌트: [components/README.md](../../frontend/components/README.md)
- API 공통: [api/API_MAP.md](../../frontend/api/API_MAP.md)
- 미확정 항목: [DECISIONS_PENDING.md](../../frontend/DECISIONS_PENDING.md)
- 구현·실행 기준: [IMPLEMENTATION_GUIDE.md](../../frontend/IMPLEMENTATION_GUIDE.md)
- 상태 전이: [STATE_TRANSITIONS.md](../../STATE_TRANSITIONS.md)
