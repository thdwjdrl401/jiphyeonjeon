# 결정 정합성·트러블슈팅 로그

> 기록 인덱스: [README.md](README.md) · 현재 정본: [AGENTS.md](../../../AGENTS.md),
> [CONTRACT.md](../../CONTRACT.md), [ARCHITECTURE.md](../../ARCHITECTURE.md)

- **정리 기준일**: 2026-08-06
- **원칙**: 열린 문제와 재사용할 해결 절차만 자세히 남긴다. 해결된 과거 초안은 현재 계약처럼
  보이지 않도록 “해결됨”으로 내리고, 최신 팀 ADR과 정본 계약을 우선한다.

## 1. 현재 후속이 필요한 항목

### 1.1 커리큘럼 공통 자료의 AI worker 소비

- **해결된 범위**: 커리큘럼 scope 자료의 presigned 업로드·연결·삭제·다운로드, 강사 관리 조회,
  공개 상세의 관계 기반 노출과 FE 저장 흐름은
  [songjeongki/0042](../songjeongki/0042-curriculum-material-attach-and-embedding-scope.md) 및
  [CONTRACT §2](../../CONTRACT.md)로 구현됐다.
- **남은 문제**: 기존 AI worker의 PPTX embedding job은 `lessonId`를 필수로 다룬다. 커리큘럼
  scope job을 실제로 소비하고, 레슨 질문에서 레슨 자료와 커리큘럼 자료를 어떤 우선순위로 합성할지,
  자료 삭제 시 어느 산출물을 무효화할지 끝내야 한다.
- **완료 기준**: curriculum scope job의 성공·실패 callback, 검색 범위, 삭제 영향이 계약 테스트와
  AI 통합 테스트로 고정된다.
- **우선순위**: P0 — 커리큘럼 공통 자료를 RAG 근거로 사용하기 전.

### 1.2 질문 인사이트·콘텐츠 검수·퀴즈

- **구현된 기반**: 채팅의 `isQuestion`, 채팅·자막·노트 REST 복구와 WS, 라이브·다시보기 AI 질문,
  용어집과 `sessionMs` 근거 이동은 구현됐다.
- **남은 문제**: 강사용 질문 핀/집중도 집계, 통합 검수 초안·버전 게시, 챕터와 퀴즈 도메인은 아직
  전체 계약·구현이 없다. 화면 명세의 제안 endpoint를 현재 API처럼 사용하면 안 된다.
- **완료 기준**: 정본 계약, FE·BE·AI 구현, 질문 프라이버시/검수 충돌/퀴즈 version 계약 테스트가
  같은 변경에서 완료된다.
- **우선순위**: P1 — 질문 인사이트·검수·CP5 착수 시.

### 1.3 장시간 HLS 라이브·다시보기 운영 검증

- **구현된 기반**: Egress EVENT playlist, 인증 manifest 재작성, delta playlist,
  `sessionOffsetMs`, 종료 후 자동 게시와 HLS 다시보기는 구현됐다.
- **남은 위험**: 장시간 세션의 playlist 갱신과 presigned segment TTL, pipeline stall,
  브라우저 일시정지·새로고침 뒤 URL 재발급, 종료 경계의 마지막 segment drain은 실제 인프라에서
  계속 검증해야 한다.
- **완료 기준**: EC2 한 세션에서 시작→되감기→LIVE 복귀→종료→다시보기까지 수행하고, 첫 PDT·세션
  시계 오차와 장시간 URL 만료 복구를 측정 기록한다.
- **우선순위**: P0 — 라이브 데모·운영 배포 전.

### 1.4 익명 순번의 프로세스 재시작 내구성

- **현재 결정**: [ADR-0023](0023-anonymous-chat-alias-is-sequential.md)은 세션별 카운터와 사용자
  매핑을 애플리케이션 메모리에 둔다.
- **위험**: 프로세스가 재시작되면 같은 세션의 매핑이 사라져 종료 후 토론이나 복구된 세션에서
  기존 사용자에게 다른 번호가 배정될 수 있다. 다중 인스턴스에서도 인스턴스별 번호가 갈린다.
- **현재 허용 범위**: SimpleBroker를 쓰는 단일 인스턴스 데모. 저장된 과거 메시지의
  `sender_name`은 바뀌지 않는다.
- **완료 기준**: 재시작·다중 인스턴스가 범위에 들어오면 Redis/DB 저장 위치, 원자적 채번, TTL과
  세션 종료 후 보존 기간을 새 ADR로 정한다.
- **우선순위**: P1 — 수평 확장 또는 재시작 복구 보장 전.

## 2. 이번 정리에서 해결된 표류

| 항목 | 이전 기록 | 현재 정리 |
|---|---|---|
| 레슨 발행 | `DRAFT ↔ PUBLISHED`, AI readiness 논의 | 레슨은 생성 즉시 `PUBLISHED`; 공개 축은 커리큘럼 lifecycle |
| 커리큘럼 공통 자료 | 프론트 fixture만 있고 API 없음 | FE/BE CRUD·다운로드·관계 게이트 구현, AI worker만 후속 |
| 학생 라이브 재생 | WebRTC 현재 + HLS 과거, 세션별 playback 초안 | 학생 HLS 단일, `GET /lessons/{lessonId}/playback` |
| 프로필 | 이미지 하나만 실제 저장 | 표시 이름·강사 프로필·비밀번호·탈퇴까지 실제 API 연결 |
| 학습 사이드바 | 공통 4탭 UI 목업 | live/replay의 REST·WS·SSE 연결, recorded는 가능한 2탭만 노출 |
| 용어-자막 연결 | 서버가 `termId`와 문자열 범위를 제공할 계획 | FE가 조회한 용어집으로 자막을 정규화 매칭 |
| 북마크 | 라이브·VOD 공통 기능 | [ADR-0024](0024-remove-bookmark-feature.md)로 제품·계약·FE/BE·DB 제거 |
| API 문서 링크 | 이동 뒤 상대 경로 오류 기록 | 링크 검사 기준 현재 깨진 링크 0건 |

## 3. 해결된 트러블슈팅과 재사용 절차

| 주제 | 해결 | 다시 지킬 점 |
|---|---|---|
| master에서 문서 작성 | 전용 브랜치에서 다시 작업 | 시작 전 `git branch --show-current`·`git status --short` 확인 |
| 단일 명세 비대화 | `PAGES.md`, `components/`, `api/`로 분리 | 정본은 복제하지 않고 인덱스로 연결 |
| 콘텐츠 용어 변경 | 커리큘럼 → 섹션 → 레슨으로 통일 | 폐기 용어를 현재 DTO·UI에 다시 쓰지 않음 |
| 자료 형식 변경 | 초기 범위는 PPTX로 확정 | 합의 전 enum·storage schema를 먼저 고정하지 않음 |
| LiveKit 되감기 오해 | SFU=현재 송출, Egress=녹화, HLS=재생으로 분리 | producer/recorder/playback 책임을 구분 |
| API prefix 변경 | `/api/v1` 초안을 버리고 `/api` 사용 | 현재 정본은 `CONTRACT.md` |
| 화면별 mock 상태 불일치 | ID·관계 기반 통합 fixture와 enrollment store 사용 | 제목·배열 index로 상태를 만들지 않음 |
| 병합 충돌 | 양쪽 기능을 보존한 뒤 중복 import와 최종 의미 재구성 | 충돌 마커 제거보다 결과 동작 검증이 우선 |
| 미커밋 변경을 둔 채 분기 | working tree가 새 브랜치에 따라가는 성질 확인 | “따라감”과 “분리 완료”를 혼동하지 않음 |
| staging 표시 혼동 | `git status --untracked-files=all`, `git check-ignore -v` 사용 | IDE 표시는 Git 상태의 근거가 아님 |
| Vite build 권한 실패 | 코드 오류와 filesystem sandbox 오류를 분리 | 권한 로그를 확인한 뒤 같은 명령만 승인 범위에서 재실행 |
| 가짜 프로필 저장 | 구현된 계약만 활성화, 이후 API가 생겼을 때 실제 저장 연결 | 로컬 상태 변경을 서버 저장 성공처럼 보이지 않음 |

## 4. 문서 정리 검증 체크리스트

1. 새 ADR 번호는 최신 `master`와 원격 작업 브랜치를 함께 검색한다. 열린 MR을 직접 조회할 수 없으면
   그 제약을 완료 보고에 남긴다.
2. ADR 상태는 `채택 / 부분 대체 / 대체됨 / 부분 구현` 중 하나로 현재 의미를 드러낸다.
3. 과거 결정을 본문에서 지우지 않고 날짜가 있는 정합화 note와 후속 ADR 링크를 추가한다.
4. API 필드·상태코드·경로를 실제로 바꾸면 `CONTRACT.md`, FE·BE와 계약 테스트를 함께 바꾼다.
   기존 구현을 설명하는 문서 정리만 했다면 그 사실을 완료 게이트에 명시한다.
5. `node docs/harness/templates/check-links.mjs`와 `git diff --check`를 실행한다.
6. 북마크처럼 제거된 기능은 다음 검색으로 잔여 현재형 표현을 확인한다.

```powershell
rg -n 'bookmark|북마크' docs/decisions/yoongwanghyeok
```

남은 검색 결과는 대체 관계·제거 ADR·역사적 맥락이어야 하며, 현재 제공 기능 목록이어서는 안 된다.

## 5. 유지할 설계 원칙

1. 역할 prefix는 탐색 경계이고, 소유권·수강 관계는 서버 권한 경계다.
2. mock과 HTTP는 한 실행에서 섞지 않고 feature service 구현체 단위로 전환한다.
3. fixture도 데이터 모델이다. 사용자·커리큘럼·수강·레슨·세션 관계를 ID로 공유한다.
4. 선택 파일 없음, 기록 없음, 준비 중은 정상 상태로 모델링한다.
5. 라이브·다시보기의 미디어와 자막·채팅·노트·AI 근거는 같은 세션 상대 시간축을 사용한다.
6. ADR은 과거 결정을 보존하되, 현재 정본과 다른 부분은 대체 관계를 첫 화면에서 바로 보이게 한다.

