# ADR-0026: 카탈로그 응답에 viewerContext를 담고, 내 수강 목록 조립을 curriculum 모듈이 맡는다

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 판단 정책: [../../harness/POLICY.md](../../harness/POLICY.md)

- **상태**: 채택
- **일자**: 2026-07-22
- **관련**: Sub Ⅱ / CP0 · [CONTRACT §2](../../CONTRACT.md) · [ADR-0023](0023-asset-presigned-upload.md)

> **후속 상태(2026-08-02)**: 아래 “값이 비는 필드”는 이 ADR 채택 당시의 구현 기록이다. 녹화 완료
> webhook은 이후 구현됐고, 새 정상 녹화는
> [ADR-0007](../choinhoo/0007-recording-ready-auto-publish-and-processing-polling.md)에 따라
> `READY + PUBLISHED`로 자동 확정하는 목표가 채택됐다. 기존 `READY + DRAFT`만 수동 게시 대상으로 남는다.

## 맥락 (Context)

프론트가 mock에서 실 API로 넘어가려는 시점에 두 가지가 걸렸다.

1. **커리큘럼 상세가 "누가 보는지"를 모른 채 답했다.** FE는 주 CTA(수강 신청 / 이어서 학습 / 관리하기 /
   로그인 후 수강)와 레슨 진입 가능 여부를 `viewerContext`·`enrollmentPolicy`·레슨별 `access`로 정하도록
   설계돼 있는데, 서버가 그 필드를 주지 않았다. FE는 없으면 안전한 쪽으로 폴백하도록 짜여 있어서
   `enrollmentPolicy=INVITATION_ONLY/UNAVAILABLE`, `allowedActions=[VIEW_DETAIL]`,
   `access.allowed=false`가 되고, **화면 전체가 잠긴 것처럼 보였다.** 값을 안 주는 것이 "기능 없음"이
   아니라 "기능 꺼짐"으로 나타나는 구조였다.

2. **내 수강 목록이 화면을 그릴 수 없었다.** `GET /api/me/enrollments`가 수강 기록 5필드만 주는데,
   화면은 제목·썸네일·강사·진행률이 있는 카드를 그린다. FE가 수강 건마다 커리큘럼을 다시 조회하면 N+1이다.
   그런데 수강 기록은 `enrollment` 모듈이, 커리큘럼 카드는 `curriculum` 모듈이 소유한다.
   `enrollment`에서 커리큘럼을 읽으면 `curriculum → enrollment` 와 맞물려 모듈 순환이 생긴다
   (Spring Modulith 검증에 걸린다).

FE가 역할·수강상태를 스스로 조합해 CTA를 정하는 방법도 있지만, 같은 판정 규칙이 서버(인가)와
클라이언트(표시) 두 곳에 생겨 어긋나기 시작한다.

## 결정 (Decision)

1. **카탈로그 목록·상세 응답에 `viewerContext`를 싣는다.** 관계(GUEST·UNENROLLED_STUDENT·
   PENDING_ENROLLMENT·ENROLLED·OWNER_INSTRUCTOR·NON_OWNER_INSTRUCTOR)와 그 관계에서 허용되는
   행동(`allowedActions`)을 서버가 판정한다. 상세에는 `enrollmentPolicy`와 목차 레슨별
   `liveSession`·`access`·`replayStatus`도 함께 싣는다.
   **`allowedActions`는 실제 API가 받아 줄 행동만 담는다** — 신청이 409로 떨어질 상황(초대 전용·
   미발행·모집 창 밖)에서는 `ENROLL`을 주지 않는다. FE는 이 목록만 보고 버튼을 켜므로, 여기서
   느슨하게 주면 버튼이 거짓말을 한다.
2. 공개 경로(`GET /api/curriculums`, `/{id}`)는 permitAll을 유지하되 **`Authentication`을 선택적으로
   받는다.** 쿠키가 있으면 그 사용자 기준, 없으면 손님 기준으로 답한다.
   `enrollmentPolicy.status`는 저장값이 아니라 **모집 창(`enrollmentOpensAt`·`enrollmentClosesAt`) +
   현재 시각에서 파생**한다(`OPEN`·`NOT_OPEN`·`CLOSED`·`UNAVAILABLE`). DDL 주석이 정한 규칙과 같고,
   판정 조건은 신청 API의 전제조건과 일치시킨다.
3. **`/api/me/enrollments`의 소유 모듈을 `curriculum`으로 옮긴다.** 경로와 기존 필드는 그대로 두고
   `curriculum` 카드를 항목마다 덧붙인다. 이미 `enrollment`를 참조하고 있는 `curriculum`이 조립을 맡아
   순환을 만들지 않는다.

## 근거 (Rationale)

- **판정 규칙은 한 곳에.** 누가 무엇을 할 수 있는가는 이미 서버가 인가로 판정한다. 표시용 판정을
  클라이언트에 복제하면 두 규칙이 갈라지고, 갈라진 쪽은 대개 보안이 아니라 UX가 깨지는 형태로 드러난다.
- **"필드 없음"이 "기능 없음"으로 보이지 않게.** 아직 배선되지 않은 값(진도)도 필드는 계약에 포함하고
  `null`로 명시해 내보낸다. FE가 값을 추측하지 않고, 배선되면 서버만 채우면 된다.
- **하드코딩 대신 실제 값을 읽는다.** 다시보기 상태·재생 길이는 `video` 모듈이 이미 들고 있으므로
  포트로 읽어 온다. "아직 없을 것"이라고 단정해 상수를 내보내면, 데이터가 생긴 뒤에도 응답이 계속
  거짓말한다.
- **모듈 방향은 이미 정해져 있었다.** `curriculum → enrollment`는 수강 신청·승인에서 이미 쓰고 있다.
  반대 방향을 새로 만들지 않고 기존 방향에 얹는 쪽이 경계를 지키면서 가장 적게 움직인다.

## 대안 (Alternatives)

| 대안 | 장점 | 단점 |
|---|---|---|
| (선택) 서버가 viewerContext까지 판정해 응답 | 규칙 한 곳, FE 폴백 불필요, 화면이 바로 살아남 | 공개 조회가 인증을 선택적으로 알아야 함, 수강 조회 1회 추가 |
| FE가 역할·수강상태로 CTA를 조합 | 서버 변경 없음 | 판정 규칙 이원화, 카드마다 수강 여부를 따로 조회해야 함 |
| viewerContext 전용 엔드포인트를 분리 | 공개 캐시가 쉬움 | 화면 한 장에 왕복 2회, 두 응답의 시점 불일치 |
| `enrollment`가 커리큘럼을 읽어 목록을 조립 | 경로 소유가 직관적 | `curriculum ↔ enrollment` 순환 — Modulith 검증 실패 |

## 영향·후속 (Consequences)

- `GET /api/curriculums`·`/{id}`·`/api/me/enrollments` 응답에 필드가 **추가**된다(기존 필드 유지 →
  기존 소비자 무해). [CONTRACT §2](../../CONTRACT.md) 갱신.
- 계약 테스트 `CatalogViewerContextContractTest` 추가 — 관계별로 어떤 행동이 열리는지, 라이브가 잡힌
  레슨이 라이브 쪽으로 향하는지를 실제 로그인 흐름으로 검증한다.
- `enrollment/web` 패키지 제거(컨트롤러·DTO가 `curriculum/web`으로 이동). `enrollment`는 도메인·포트만
  갖는 모듈이 된다.
- `LiveSessionDirectory.findByLessons`(배치 조회) 추가 — 목차가 레슨마다 세션을 묻지 않도록.
- **채택 당시 값이 비던 필드와 그 이유** (당시 각각 사실 확인함):
  - `progress`·`learning` — `learning` 패키지(`LearningProgress`·`Bookmark`)가 엔티티만 있고
    배선되지 않았다([ADR-0024](0024-orphan-module-scaffolding.md)). 배선 시 채운다.
  - `durationMs` — `video_asset`에 컬럼은 있으나 녹화 완료 webhook(FINALIZING→VERIFYING→READY)이
    아직 없어 채워지지 않는다. 값이 생기면 그대로 흘러나간다.
  - `replayStatus` — **비어 있지 않다.** 당시 녹화가 없으면 `NOT_READY`, 라이브를 한 번 한 레슨은
    `DRAFT`였고 게시 검수 흐름 전이라 `PUBLISHED`와 `destination=VOD`에 도달하지 않았다. 현재 목표
    정책은 위 후속 상태처럼 새 정상 녹화를 자동 게시한다.
  - `materials` — 커리큘럼 단위 자료를 연결하는 API가 없다. 스키마의 `material_asset`은 **강의 단위**라
    모델이 갈린다(별건으로 정리 필요). 에셋 업로드도 `MATERIAL` kind는 현재 400으로 거부된다.
