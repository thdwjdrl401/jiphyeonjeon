# 상태 모델 구현 감사

> 기준일: 2026-07-22  
> 부분 재감사: 2026-08-02 — 라이브 종료·녹화·replay 공개 축만 ADR-0007 기준으로 갱신
> 상태 전이 목표: [STATE_TRANSITIONS.md](STATE_TRANSITIONS.md)  
> 런타임 계약: [CONTRACT.md](CONTRACT.md)

## 1. 목적

이 문서는 LiveClass AI에서 상태에 따라 동작이 달라지는 요소를 문서, DB, 백엔드, 프론트엔드 기준으로 교차 확인한 결과다.

다음 네 가지를 구분한다.

1. DB와 enum이 허용하는 상태값
2. 서비스 코드에서 실제로 도달할 수 있는 상태와 전이
3. 프론트엔드가 mock 또는 로컬 상태로 계산하는 파생 상태
4. 문서와 코드 또는 FE와 BE 사이의 충돌과 미구현 구간

이 문서는 목표 상태기를 정의하는 정본이 아니다. 목표 전이와 정책은 [STATE_TRANSITIONS.md](STATE_TRANSITIONS.md)를 따르고, 이 문서는 현재 구현과의 차이를 추적하는 감사 자료로 사용한다.

## 2. 조사 범위

포함 범위:

- `docs/`의 현재 아키텍처, 계약, 상태 전이, 프론트 API·컴포넌트 문서
- `backend/`의 DB migration, enum, entity, service, controller, test
- `frontend/`의 타입, API adapter, 통합 mock, 라우팅, 상태별 화면 분기
- `infra/`, `scripts/`의 상태 관련 문자열과 설정

제외 범위:

- `docs/legacy/`
- `docs/decisions/`
- `docs/frontend/design/`
- `node_modules/`, `build/`, `dist/` 등 외부 의존성·생성 산출물

## 3. 요약

현재 상태 모델은 크게 세 층으로 나뉜다.

| 구분 | 의미 | 대표 요소 |
|---|---|---|
| 실제 상태기 | 저장과 서비스 전이가 모두 구현됨 | 커리큘럼 lifecycle, 수강 lifecycle |
| 부분 상태기 | 전체 값은 선언됐으나 일부 전이만 구현됨 | 계정, 레슨, asset, 라이브 강의, 녹화 자산 |
| 목표·표현 상태 | 문서 목표 또는 프론트 mock·로컬 UI에만 존재 | 자료 작업, AI 처리, replay 게시, preflight, 학습 상태 |

현재 비교적 신뢰할 수 있는 실제 전이는 다음과 같다.

- 커리큘럼: `DRAFT → PUBLISHED → ARCHIVED`
- 수강: `PENDING → ACTIVE/REJECTED/CANCELLED`, `ACTIVE → REVOKED/CANCELLED`
- 계정: 회원가입 시 `ACTIVE`, 로그인은 `ACTIVE`만 허용
- 공용 asset: `PENDING → UPLOADED`, 만료된 `PENDING → FAILED`
- 라이브 강의: `DRAFT/SCHEDULED/OPEN → LIVE → ENDED`, 시작 전 `→ CANCELLED`
- 녹화 자산: `STARTING → RECORDING → FINALIZING → VERIFYING → READY`, 각 단계 실패 시 `FAILED`

레슨 AI 준비, 자료 작업, 학습 진도는 전체 상태값에 비해 실제 서비스 전이가 부족하다. 녹화 검증,
영상 자동/수동 게시·철회, 강사 processing 조회·폴링은 부분 재감사 뒤 구현됐다.

백엔드 계약 정리 후 명칭과 구현 범위를 다시 대조한 결과는 다음과 같다.

| 항목 | 현재 정본·백엔드 | 프론트 상태 | 판정 |
|---|---|---|---|
| 인증 식별자 | `email`, `GET /api/auth/email-availability` | 이미 `email` 사용 | 코드·계약 정렬, CP0 질문 문서 미종료 |
| 커리큘럼 명칭 | `curriculum`, `curriculumId` | 동일 명칭 사용 | 과거 `course/courseId` 드리프트 해소 |
| 레슨 상태 필드 | `status` | `status` 사용 | **해소** — 아래 §7.1-1 참고(2026-07-23) |
| 채팅 범위 키 | REST·WS 경로와 envelope는 `sessionId` | API·WS 연동 없음 | FE 미연동, WS payload 문서 편차 있음 |
| 프로필 | `GET /api/auth/me`, `PUT /api/me/profile-image`만 구현 | 텍스트 편집은 로컬 상태, 이미지 UI 없음 | 구현 범위와 UI 불일치 |

## 4. 저장되는 핵심 상태

### 4.1 계정과 역할

#### 계정 상태

가능한 값:

```text
PENDING | ACTIVE | SUSPENDED | WITHDRAWN
```

현재 동작:

- 회원가입은 이메일 인증 흐름이 없어 바로 `ACTIVE`로 생성한다.
- 로그인은 `ACTIVE`만 허용한다.
- `PENDING`, `SUSPENDED`, `WITHDRAWN`으로 변경하는 API는 없다.
- 비활성 계정 로그인은 계정 존재 여부를 드러내지 않도록 일반 인증 실패로 처리한다.

근거:

- `backend/src/main/java/com/liveclass/auth/domain/AccountStatus.java`
- `backend/src/main/java/com/liveclass/auth/service/AuthService.java`
- `backend/src/main/resources/db/migration/V1__init_core.sql`

#### 역할

백엔드:

```text
STUDENT | INSTRUCTOR | OPERATOR
```

프론트엔드:

```text
STUDENT | INSTRUCTOR
```

역할은 로그인 후 경로, 권한 화면, 강사·학생 UI를 분기한다. `OPERATOR`는 가입 경로와 프론트 라우팅에 포함되지 않는다.

프론트 인증 UI는 계정 상태를 직접 사용하지 않고 다음 상태를 별도로 계산한다.

```text
loading | authenticated | guest
```

#### 인증·프로필 계약 경계

- 인증 식별자는 백엔드, 계약 문서, 프론트 모두 `email`로 정렬되어 있다.
- 현재 조회 가능한 프로필 성격의 응답은 `GET /api/auth/me`이며 `userId`, `email`, `displayName`, `role`, `profileImageUrl`을 반환한다.
- 현재 수정 가능한 프로필 기능은 `PUT /api/me/profile-image`뿐이다.
- `displayName`, `bio`, `expertise` 조회·수정 API는 구현되지 않았다.
- 프론트 `AuthUser` 타입에는 백엔드가 반환하는 `profileImageUrl`이 없고, 프로필 이미지 업로드·지정 UI도 없다.
- `ProfilePage`의 표시 이름과 강사 소개·전문 분야 저장은 서버 요청 없이 `savedArea` 로컬 상태만 바꾼다. 따라서 화면의 `초안이 저장되었습니다`는 영속 상태가 아니다.

근거:

- `backend/src/main/java/com/liveclass/auth/web/AccountController.java`
- `backend/src/main/java/com/liveclass/auth/web/dto/AuthUserResponse.java`
- `frontend/src/features/auth/types.ts`
- `frontend/src/pages/ProfilePage.tsx`
- `docs/frontend/components/PROFILE.md`

### 4.2 커리큘럼 lifecycle

가능한 값:

```text
DRAFT | PUBLISHED | ARCHIVED
```

실제 전이:

```text
생성 → DRAFT
DRAFT → PUBLISHED
PUBLISHED → ARCHIVED
```

적용 분기:

- 공개 카탈로그는 `PUBLISHED`만 조회한다.
- `DRAFT`가 아니면 게시할 수 없다.
- `PUBLISHED`가 아니면 보관할 수 없다.
- 복원, 게시 취소, 삭제 전이는 없다.

근거:

- `backend/src/main/java/com/liveclass/curriculum/domain/CurriculumLifecycleStatus.java`
- `backend/src/main/java/com/liveclass/curriculum/service/InstructorCurriculumService.java`
- `backend/src/main/java/com/liveclass/curriculum/service/CatalogService.java`

프론트 차이:

- 강사 대시보드는 `PUBLISHED`만 `공개 중`, 나머지는 모두 `준비 중`으로 표시하여 `DRAFT`와 `ARCHIVED`를 구분하지 않는다.
- 커리큘럼 관리 화면의 `커리큘럼 게시` 버튼은 lifecycle API를 호출하지 않고 현재 mock 저장 함수만 실행한다.

### 4.3 수강 방식과 모집 가능 상태

수강 방식의 가능한 값:

```text
IMMEDIATE | APPROVAL_REQUIRED | INVITATION_ONLY
```

현재 동작:

- 커리큘럼 생성 서비스는 `APPROVAL_REQUIRED`로 고정한다.
- `APPROVAL_REQUIRED` 신청은 `PENDING`을 생성한다.
- `IMMEDIATE` 신청은 바로 `ACTIVE`를 생성할 수 있도록 백엔드가 지원한다.
- `INVITATION_ONLY`는 일반 신청을 거부한다.
- DB 기본값은 `IMMEDIATE`지만 애플리케이션 생성 서비스가 `APPROVAL_REQUIRED`를 명시한다.

모집 가능 여부는 lifecycle과 별도 축이다. 문서 제안값은 다음과 같다.

```text
NOT_OPEN | OPEN | CLOSED
```

현재는 서버 응답 필드와 계산 로직이 없다.

- 프론트 mock 상세는 항상 `OPEN`을 반환한다.
- HTTP 상세 응답에 모집 정책이 없으면 프론트가 `INVITATION_ONLY + UNAVAILABLE`로 보정한다.

### 4.4 수강 lifecycle

가능한 값:

```text
PENDING | ACTIVE | REJECTED | REVOKED | CANCELLED
```

실제 전이:

```text
신청 생성 ─→ PENDING ─→ ACTIVE ─→ REVOKED
                     ├→ REJECTED
                     └→ CANCELLED

ACTIVE ─────────────────────→ CANCELLED
```

세부 규칙:

- 승인과 거절은 `PENDING`에서만 가능하다.
- 회수는 `ACTIVE`에서만 가능하다.
- 학생 취소는 `PENDING`, `ACTIVE`에서 가능하다.
- `REJECTED`, `REVOKED`, `CANCELLED` 상태에서 재신청하면 동일한 `(curriculumId, userId)` 행을 다시 `PENDING` 또는 `ACTIVE`로 사용한다.
- 낙관적 잠금으로 동시 승인·취소 충돌을 방지한다.

프론트 차이:

- 프론트 타입은 `ACTIVE | PENDING`만 표현한다.
- mock 취소는 상태를 `CANCELLED`로 남기지 않고 수강 행을 삭제한다.
- 거절, 회수, 취소 이력과 종료 상태에서의 재신청을 mock으로 재현할 수 없다.

근거:

- `backend/src/main/java/com/liveclass/enrollment/api/EnrollmentStatus.java`
- `backend/src/main/java/com/liveclass/enrollment/service/EnrollmentService.java`
- `frontend/src/features/enrollment/types.ts`
- `frontend/src/features/demo/mockDatabase.ts`

### 4.5 레슨 lifecycle

백엔드와 문서의 상태 필드명은 `status`다. 가능한 값은 다음과 같다.

```text
DRAFT | AI_NOT_READY | READY | PUBLISHED
```

ADR-0007 확정 목표 전이:

```text
DRAFT → AI_NOT_READY → READY → PUBLISHED
```

현재 실제 전이:

```text
생성 → DRAFT
DRAFT 등 비게시 상태 → PUBLISHED
PUBLISHED → DRAFT
```

현재 코드 특성:

- `AI_NOT_READY`, `READY`를 만드는 서비스가 없다.
- 자료 추가·삭제 후 `AI_NOT_READY`로 되돌리는 로직이 없다.
- 게시 서비스는 AI 준비 여부를 확인하지 않는다.
- 상위 서비스는 이미 `PUBLISHED`인지 여부만 검사하므로 DB에 `AI_NOT_READY` 또는 `READY`가 들어 있어도 바로 `PUBLISHED`로 만들 수 있다.
- 공개 목차는 `PUBLISHED` 레슨만 반환한다.

프론트 차이:

- 타입은 네 상태를 모두 지원한다.
- 다만 프론트 정본 타입과 mock은 상태 필드명을 아직 `lessonStatus`로 사용한다.
- HTTP adapter도 `lessonStatus`가 오는 것으로 타입을 선언하고 `status → lessonStatus` 정규화를 하지 않는다. 실제 백엔드 목차 응답을 받으면 반환 객체에는 `status`만 남고 프론트가 읽는 `lessonStatus`는 `undefined`가 된다.
- 그 결과 HTTP 모드에서 `lessonStatus === 'PUBLISHED'` 비교가 실패해 게시된 레슨도 `준비 중`으로 표시될 수 있다. mock은 `lessonStatus`를 제공하므로 개발 기본 설정에서는 이 편차가 가려진다.
- 통합 mock은 사실상 `DRAFT`, `PUBLISHED`만 생성한다.
- 레슨 목록의 첫 번째 태그는 `PUBLISHED`면 `게시됨`, 나머지 세 상태는 모두 `준비 중`으로 축약한다.
- 강사용 레슨 상세의 준비 상태는 프론트의 구 필드 `lessonStatus`와도 별개로 `PUBLISHED`, `READY`를 고정 표시한다.

근거:

- `backend/src/main/java/com/liveclass/lesson/domain/LessonStatus.java`
- `backend/src/main/java/com/liveclass/lesson/service/LessonManagementService.java`
- `backend/src/main/java/com/liveclass/curriculum/service/InstructorCurriculumService.java`
- `frontend/src/features/lesson/types.ts`
- `frontend/src/features/curriculum-detail/curriculumDetailService.ts`
- `frontend/src/features/lesson/CurriculumLessonItem.tsx`
- `frontend/src/pages/LessonDetailPage.tsx`

### 4.6 공용 asset

가능한 값:

```text
PENDING | UPLOADED | FAILED | DELETED
```

실제 전이:

```text
업로드 요청 → PENDING
PENDING 등 미완료 상태 → UPLOADED
만료된 PENDING → FAILED
```

현재 제약과 공백:

- `UPLOADED` 완료 요청은 멱등 처리한다.
- `complete()`는 `UPLOADED` 외 현재 상태를 엄격히 검사하지 않는다.
- 저장소 객체가 남아 있으면 `FAILED` 또는 `DELETED`도 `UPLOADED`로 되돌아갈 가능성이 있다.
- `DELETED`로 변경하는 API와 서비스 전이가 없다.

근거:

- `backend/src/main/java/com/liveclass/asset/domain/AssetStatus.java`
- `backend/src/main/java/com/liveclass/asset/service/AssetService.java`
- `backend/src/main/java/com/liveclass/asset/service/AssetReaper.java`

### 4.7 레슨 자료 연결과 자료 작업

레슨 자료 연결 상태:

```text
ACTIVE | DELETING | DELETED
```

현재는 DB, enum, entity만 있고 자료 연결을 생성하거나 삭제하는 repository·service·controller가 없다. 따라서 애플리케이션 코드에서 도달할 수 없는 상태다.

문서가 제안하는 업로드 세부 상태:

```text
PENDING_UPLOAD → UPLOADING → UPLOADED → VALIDATING → ACTIVE
                                             └→ VALIDATION_FAILED/FAILED
ACTIVE → DELETING → DELETED
```

문서가 제안하는 자료 작업 상태:

```text
QUEUED → VALIDATING → PARSING → CHUNKING → EMBEDDING
       → GENERATING_CANDIDATES → COMPLETED
                                  └→ FAILED

삭제:
QUEUED → REMOVING_EMBEDDINGS → INVALIDATING_AI_RESULTS → COMPLETED/FAILED
```

이 상태들은 현재 서버 enum과 서비스로 구현되지 않았다. 레슨 수정 화면의 `EMBEDDING`, `READY` 표시는 로컬 `processing` boolean과 타이머로 만든 UI 표현이다.

### 4.8 라이브 강의 lifecycle

가능한 값:

```text
DRAFT | SCHEDULED | OPEN | STARTING | LIVE | ENDING | ENDED | CANCELLED | FAILED
```

목표 전이:

```text
DRAFT → SCHEDULED → OPEN → STARTING → LIVE → ENDING → ENDED
                               └──────────────→ FAILED

시작 전 상태 → CANCELLED
```

현재 실제 전이:

```text
일정 없음으로 생성 → DRAFT
일정 있음으로 생성 → SCHEDULED
DRAFT/SCHEDULED/OPEN → LIVE → ENDED
DRAFT/SCHEDULED/OPEN → CANCELLED
```

현재 코드 특성:

- `OPEN`, `STARTING`, `ENDING`, `FAILED`를 만드는 코드가 없다.
- 일정 수정은 상태를 변경하지 않으므로 `DRAFT`에 일정을 넣어도 계속 `DRAFT`다.
- 시작 시 일정 시각, 레슨 게시 상태, 자료, AI 준비, 자료 작업, preflight를 검사하지 않는다.
- 라이브 시작과 종료는 목표 중간 상태를 건너뛰고 동기적으로 `LIVE`, `ENDED`가 된다.
- 강사 또는 `ACTIVE` 수강생인지 여부는 접근 검사에서 확인한다.
- 토큰 발급은 `ENDED`, `CANCELLED`, `FAILED`만 차단한다.
- 따라서 `DRAFT`, 너무 이른 `SCHEDULED`, `OPEN`, `STARTING`, `ENDING` 상태에서도 API를 직접 호출하면 토큰이 발급될 수 있다.

근거:

- `backend/src/main/java/com/liveclass/live/domain/LiveSessionStatus.java`
- `backend/src/main/java/com/liveclass/live/service/LiveSessionService.java`
- `backend/src/main/java/com/liveclass/live/service/LiveAccessGuard.java`
- `backend/src/main/java/com/liveclass/live/web/LiveSessionController.java`

#### 라이브 채팅의 범위 키

- 채팅 REST 저장·복구는 `GET/POST /api/live-sessions/{sessionId}/messages`로 구현되어 있다.
- WebSocket 송신 경로, 구독 topic, 공통 envelope도 `sessionId` 기준이다.
- 백엔드 WebSocket `ChatMessagePayload`에는 `lessonId`와 `sessionId`가 모두 있으며 실명과 `userId`는 없다.
- 반면 `CONTRACT.md`의 WebSocket 요약은 아직 `chat_message { lessonId, userId, sessionMs, text, alias }`로 적혀 있어 실제 payload와 충돌한다.
- 프론트 라이브 화면은 REST `GET/POST /api/live-sessions/{sessionId}/messages`를 호출한다. WebSocket 연동은 후속 범위다.
- 다시보기 화면은 `lessonId`로 진입하지만 채팅 복구 API는 `sessionId`를 요구한다. 현재의 lesson-session 연결을 조회하는 계약이 없으므로 리플레이 채팅 연동 전에 해석 경로를 설계해야 한다.

근거:

- `backend/src/main/java/com/liveclass/live/web/ChatController.java`
- `backend/src/main/java/com/liveclass/live/web/ws/ChatMessagePayload.java`
- `backend/src/main/java/com/liveclass/live/web/ws/WsEnvelope.java`
- `docs/CONTRACT.md`
- `docs/cp0-open-questions.md`
- `docs/frontend/api/VOD_LEARNING_AI.md`

### 4.9 녹화 자산

가능한 값:

```text
STARTING | RECORDING | FINALIZING | VERIFYING | READY | FAILED
```

목표 전이:

```text
STARTING → RECORDING → FINALIZING → VERIFYING → READY
                                              └→ FAILED
```

현재 실제 전이:

```text
신규/FAILED → STARTING → RECORDING → FINALIZING → VERIFYING → READY
                    └→ FAILED                     └→ FAILED
```

현재 코드 특성:

- 라이브 시작 오케스트레이터가 `LiveRecordingControl` 동기 포트로 Egress 준비를 확인한 뒤 `LIVE`를 확정한다.
- 라이브 종료 오케스트레이터가 Room 삭제 뒤 같은 포트로 Egress stop을 보완 호출한다.
- 녹화 종료 후 `FINALIZING`, Egress 완료 webhook 뒤 `VERIFYING → READY/FAILED`를 별도 상태축으로 관리한다.
- 사용하지 않던 `REQUESTED`는 ADR-0006으로 enum과 현재 DB 제약에서 제거했다.
- 녹화 실패가 라이브 강의 상태를 실패로 되돌리지는 않는다.

근거:

- `backend/src/main/java/com/liveclass/video/domain/VideoAssetStatus.java`
- `backend/src/main/java/com/liveclass/video/service/RecordingService.java`
- `backend/src/main/java/com/liveclass/video/service/RecordingOrchestrationService.java`
- `backend/src/main/java/com/liveclass/live/service/LiveEndOrchestrator.java`

### 4.10 다시보기 공개 상태

백엔드와 문서의 가능한 값:

```text
DRAFT | PUBLISHED | WITHDRAWN
```

전이(ADR-0090 — **영상에는 검수 단계가 없다**):

```text
정상 녹화:   DRAFT ──(VideoAsset READY와 원자적 확정)──→ PUBLISHED
실패 잔여:   DRAFT(FAILED 자산) ──(강사 수동 게시)──→ PUBLISHED
공개 관리:   PUBLISHED → WITHDRAWN ──(강사 수동 재게시)──→ PUBLISHED
```

현재 구현:

- 녹화 자산 생성 시 `DRAFT`를 설정한다.
- 소유 강사의 수동 publish·withdraw 서비스와 API는 구현돼 있다.
- 성공 webhook은 `VideoAsset READY + ReplayStatus PUBLISHED`를 같은 트랜잭션에서 확정한다.
- 강사 processing 조회 API, FE polling과 `READY + PUBLISHED` replay `replace` 이동이 구현됐다.
- `READY_FOR_REVIEW`는 **제거했다**(ADR-0090). 어디서도 설정한 적이 없었고, 남아 있는 동안 화면과 문서가 검수 흐름이 있는 것처럼 말하게 했다. DB `CHECK`에는 값이 남아 있다(무해).
- 프론트에는 녹화 자산 또는 replay 자체가 없음을 나타내는 `NOT_READY`가 추가되어 있다.
- `NOT_READY`는 서버 enum이 아니라 프론트 파생 상태다.

레슨 목록의 두 번째 태그 분기:

1. replay `PUBLISHED` → `다시보기 가능`
2. live `ENDING/ENDED` 또는 replay `DRAFT` → `다시보기 준비 중`
3. live가 존재하고 `DRAFT/CANCELLED/FAILED`가 아님 → `라이브 예정`
4. 그 외 → `라이브 일정 준비 중`

### 4.11 AI 연동 outbox와 inbox

Outbox:

```text
PENDING | PUBLISHED | FAILED
```

Inbox:

```text
RECEIVED | PROCESSED | FAILED
```

현재는 migration, enum, entity만 있다. 이벤트 저장, relay, 재시도, 처리 완료·실패 전이를 수행하는 서비스가 없다.

`docs/ai-schema-draft.sql`의 AI 내부 상태는 적용되지 않은 초안이다.

```text
model run: RUNNING | DONE | FAILED
job run: QUEUED | RUNNING | DONE | FAILED
```

## 5. 저장 상태가 아닌 파생 상태

### 5.1 사용자와 커리큘럼의 관계

```text
GUEST
UNENROLLED_STUDENT
PENDING_ENROLLMENT
ENROLLED
OWNER_INSTRUCTOR
NON_OWNER_INSTRUCTOR
```

이 값은 저장 lifecycle이 아니다. 현재 사용자, 역할, 강사 소유권, 수강 상태를 조합해 계산한다.

현재 계산 주체:

- mock 모드: 프론트 통합 mock이 계산
- HTTP 모드: 백엔드 상세 응답에 `viewerContext`가 없어 프론트 fallback이 로그인 여부와 역할만으로 계산

HTTP fallback은 실제 소유권과 수강 상태를 알 수 없으므로 다음 오분류가 가능하다.

- 실제 수강생 → `UNENROLLED_STUDENT`
- 실제 운영 강사 → `NON_OWNER_INSTRUCTOR`

### 5.2 허용 행동

프론트가 정의한 대표 행동:

```text
VIEW_DETAIL
ENROLL
CONTINUE_LEARNING
MANAGE_CURRICULUM
JOIN_LIVE
LOGIN_TO_ENROLL
CANCEL_ENROLLMENT
VIEW_LESSON
EDIT_LESSON
OPEN_LIVE_SESSION
```

현재 이 값은 프론트 mock 전용이다. 백엔드 커리큘럼 목록·상세 응답에는 `allowedActions`가 없다.

### 5.3 레슨 접근 목적지

```text
LESSON_DETAIL | LIVE_SESSION | LIVE_CLASSROOM | VOD
```

mock 계산 규칙:

- live `LIVE` → `LIVE_CLASSROOM`
- live `DRAFT/SCHEDULED/OPEN/STARTING` → `LIVE_SESSION`
- replay `PUBLISHED` → `VOD`
- 나머지 → `LESSON_DETAIL`

현재 `LIVE_SESSION` 목적지는 별도 세션 상세 페이지로 이동하지 않고 레슨 상세 경로로 매핑된다.

### 5.4 학생 라이브 입장 가능 여부

프론트 계산:

- `OPEN`, `STARTING`, `LIVE`면 입장 가능
- `SCHEDULED`이고 브라우저 현재 시각이 예정 시각 10분 전 이후면 입장 가능
- 나머지는 입장 불가

문서 권장 방향은 서버가 입장 가능 상태 또는 `allowedActions`를 계산하는 것이다. 현재 브라우저 시각 계산은 UX 분기일 뿐 보안 판정이 될 수 없다.

### 5.5 prejoin과 preflight

학생 prejoin 로컬 상태:

```text
speaker | autoplay | network | consent
```

모두 `true`면 입장 링크가 활성화된다.

강사 preflight 로컬 상태:

```text
camera | microphone | network | checked
```

현재 서버 검사 목록은 고정 성공값으로 표시된다.

```text
LESSON_PUBLISHED
MATERIAL_READY
AI_READY
LIVEKIT_READY
EGRESS_READY
STT_READY
```

preflight의 `라이브 시작` 버튼은 서버 `/start` API를 호출하지 않고 강의실 경로로 이동한다.

학생 강의실 직접 접근 방지는 React Router navigation state의 `prejoinSessionId`로 처리한다. 새로고침이나 직접 URL 접근 시 prejoin으로 되돌리지만 서버 보안 검사를 대신하지 않는다.

### 5.6 학습 상태와 진도

문서 제안 학습 상태:

```text
UPCOMING | IN_PROGRESS | COMPLETED
```

현재 백엔드는 `learning_progress` 테이블과 entity만 있고 repository, service, API가 없다.

저장 필드:

- `lastPositionMs`
- `progressPercent`
- `watchedRanges`
- `completedAt`
- `clientUpdatedAt`

DB 주석은 유효 시청 90%를 완료 기준으로 설명하지만 이를 계산하는 서비스가 없다. `progress_percent`에도 0~100 CHECK 제약이 없다.

현재 프론트 mock 계산:

- 수강 데이터의 `completedLessonCount` 이하 순서 레슨을 완료로 처리
- 마지막 학습 레슨은 `sessionMs / durationMs`로 진행률 계산
- 현재 레슨 진행률은 최대 99로 제한
- 커리큘럼 진행률 `>= 100`이면 완료한 커리큘럼으로 계산

### 5.7 라이브 재생 모드

문서 정의:

```text
RTC_LIVE | HLS_RECENT | HLS_DVR
```

현재 라이브 강의실은 이 상태를 타입이나 서버 상태로 관리하지 않는다. `isLive: boolean`과 타임라인 진행률만으로 현재 라이브와 되감기 화면을 구분한다.

### 5.8 AI 처리와 게시 상태

문서가 구분하는 기술 처리 상태:

```text
NOT_STARTED | PROCESSING | READY | FAILED
```

문서가 구분하는 검수·게시 상태:

```text
NOT_READY | PROCESSING | READY_FOR_REVIEW | DRAFT_SAVED | PUBLISHED | FAILED
```

현재 서버 구현은 없다. 프론트의 녹화 처리·검수 화면에서 다음 값이 fixture 또는 로컬 상태로 표시된다.

- `READY`
- `VERIFYING`
- `PROCESSING`
- `NOT_STARTED`
- `READY_FOR_REVIEW`
- `DRAFT_SAVED`
- `PUBLISHED`

### 5.9 기타 문서 상태

현재 문서에만 정의되고 구현되지 않은 상태·이벤트:

- AI 답변: `ANSWERED`, `INSUFFICIENT_EVIDENCE`
- 자막 이벤트: `partial`, `final`, `revised`
- preflight 검사 결과: `PASS`와 `blocking`
- 자료 처리 polling 종료: `COMPLETED`, `FAILED`

## 6. 프론트 데이터 출처별 상태 신뢰도

프론트는 함수별 API 구현 상태를 명시하고 공통 경계에서 데이터 출처를 선택한다.

```text
test mode → mock
VITE_USE_MOCK_API=false → 모든 함수 HTTP
VITE_USE_MOCK_API=true + API 구현됨 → HTTP
VITE_USE_MOCK_API=true + API 미구현 → mock
```

카탈로그, 내 커리큘럼, 프로필 요약, 커리큘럼 관리, 레슨, prejoin/preflight, 라이브, 녹화 처리, replay와 좌측 레슨 탐색은 모두 `requestByDataSource`를 통과한다. 페이지·레이아웃은 demo/mock 모듈을 직접 읽지 않는다.

아직 미구현인 AI 준비·다시보기 자막·검수 저장·퀴즈 등은 mock=true에서만 fixture를 사용한다.
녹화 processing 조회와 replay publish는 실제 HTTP adapter로 전환됐으며, mock=false에서도 계약 endpoint를 호출한다.

근거:

- `frontend/src/shared/config/runtime.ts`
- `frontend/src/shared/api/dataSource.ts`
- `frontend/src/features/demo/mockDatabase.ts`
- `frontend/src/features/demo/demoData.ts`

## 7. 충돌과 구현 공백

### 7.1 높은 우선순위

#### 1. 레슨 상태 필드명 `status`와 `lessonStatus` 불일치

> **해소됨 (2026-07-23) — 다만 방향이 아래 서술과 반대로 뒤집혔었다.**
>
> 프론트는 이 감사 이후 `status`로 이관을 마쳤다. 그런데 백엔드 쪽에서 `OutlineLesson`이 카탈로그
> viewerContext를 추가하는 커밋에 휩쓸려 `lessonStatus`로 **되돌아가 있었다**(계약 결정 e331a1c의 회귀).
> 즉 최근까지의 실제 상태는 "FE `status` · BE `lessonStatus`"로, 아래 서술과 정반대였다.
>
> 조치: 백엔드를 `status`로 되돌리고, 값이 아니라 **필드명 자체**를 계약 테스트로 고정했다
> (`CatalogViewerContextContractTest.outline_lesson_status_uses_contract_field_name`).
> 근거와 재발 방지 이유는 [ADR-0029](decisions/songjeongki/0029-lesson-detail-and-display-name.md).
> 아래 원문은 감사 시점 기록으로 남겨 둔다.

백엔드 DTO와 계약 문서의 정본 필드는 `status`지만 프론트 타입, HTTP adapter, mock, 컴포넌트, 페이지와 테스트는 `lessonStatus`를 사용한다.

영향:

- HTTP 응답의 실제 `status`가 프론트 상태 비교에 전달되지 않는다.
- 게시된 레슨이 `준비 중`으로 잘못 표시될 수 있다.
- 기본 개발 모드의 mock 데이터는 구 필드명을 사용해 문제를 숨긴다.

조치 범위:

- `frontend/src/features/lesson/types.ts`를 기준으로 `lessonStatus → status` 변경
- `curriculumDetailService.ts`의 API 타입·정규화 변경
- `CurriculumLessonItem.tsx`, `LessonDetailPage.tsx`, `CurriculumManagePage.tsx` 소비부 변경
- `mockCurriculumDetails.ts`, `mockDatabase.ts`, `demoData.ts`와 관련 테스트 fixture 변경

#### 2. 커리큘럼 상세 FE/BE 응답 구조 불일치

프론트가 기대하는 필드:

- `enrollmentPolicy`
- `materials`
- `viewerContext`
- 레슨별 `access`
- 레슨별 `learning`
- `liveSession`
- `replayStatus`

현재 백엔드 공개 상세 응답:

- 커리큘럼 기본 정보
- 기간
- 강사 정보
- 공개된 섹션·레슨 목차

영향:

- HTTP 모드에서 실제 수강·소유 관계를 판단하지 못한다.
- 실제 라이브·replay 상태가 레슨 목록에 연결되지 않는다.
- 프론트 fallback이 모집 정책과 관계를 임의의 안전 기본값으로 바꾼다.

관련 파일:

- `backend/src/main/java/com/liveclass/curriculum/web/dto/CurriculumDetailResponse.java`
- `frontend/src/features/curriculum-detail/curriculumDetailService.ts`

#### 3. 라이브 입장 시간 정책을 서버가 강제하지 않음

프론트는 시작 10분 전을 계산하지만 백엔드 토큰 API는 종료·취소·실패만 차단한다.

영향:

- API 직접 호출 시 너무 이른 `SCHEDULED` 또는 `DRAFT`에서도 토큰을 받을 수 있다.
- 클라이언트 시계 오차와 화면 우회에 취약하다.

#### 4. 라이브 시작 조건과 preflight가 서버 시작 명령에 연결되지 않음

문서가 요구하는 조건:

- 레슨 `PUBLISHED`
- 필수 자료 존재
- AI 준비 완료
- 진행 중 자료 작업 없음
- 세션 `SCHEDULED` 또는 `OPEN`
- preflight 통과
- 강사 소유권

현재 시작 서비스는 강사 소유권과 현재 live 상태만 검사한다. 강사 preflight 화면도 `/start` API를 호출하지 않는다.

#### 5. 레슨 상태값 계약과 실제 전이 불일치

`CONTRACT.md`와 프론트 타입은 네 상태값을 계약처럼 사용하지만 백엔드 서비스는 `DRAFT ↔ PUBLISHED`만 구현한다. 이 문제는 1번의 필드명 불일치와 별개인 전이 의미 문제다.

영향:

- AI 준비 완료 전에 게시·라이브 시작 가능
- 자료 변경 후 재처리·재게시 규칙 미적용
- `AI_NOT_READY`, `READY`가 UI 표현 외에는 도달하지 않음

### 7.2 중간 우선순위

#### 6. replay `NOT_READY`가 프론트에만 존재

녹화 자산 또는 replay가 아직 없음을 표현하는 용도로 유용하지만 서버 enum과 응답 계약에는 없다. 서버의 `null`과 파생 `NOT_READY` 중 하나로 계약을 통일해야 한다.

#### 7. asset 완료 전이의 현재 상태 검사 부족

`complete()`는 `PENDING`에서만 완료하도록 제한하지 않는다. `FAILED`, `DELETED` 자산을 다시 완료할 수 있는지 정책과 코드 검사가 필요하다.

#### 8. 프론트 수강 취소가 `CANCELLED`를 보존하지 않음

mock 삭제 방식은 백엔드 상태기, 이력, 재신청, 동시 상태 충돌을 재현하지 못한다.

#### 9. 커리큘럼 lifecycle 표시 축약

`DRAFT`, `ARCHIVED`가 모두 `준비 중`으로 표시된다. 보관 상태와 편집 중 초안을 UI에서 구분할 필요가 있다.

#### 10. 학습 완료 기준 미연결

문서는 90% 유효 시청 완료를 설명하지만 서버 계산이 없고 mock은 커리큘럼 진행률 100%를 완료 기준으로 사용한다.

#### 11. 녹화 자동 게시와 processing 흐름 구현 완료

녹화는 webhook에서 `FINALIZING → VERIFYING → READY/FAILED`로 진행되고 정상 성공 시
`READY + PUBLISHED`를 원자적으로 확정한다. processing API와 FE adapter, 2초→5초 폴링,
terminal 중단, replay `replace` 자동 이동과 실제 서버 게시 상태 표시가 구현됐다. 기존
`READY + DRAFT`와 `WITHDRAWN`은 자동 게시하지 않고 수동 게시 동선을 유지한다.

#### 12. 프로필 UI의 저장 상태와 서버 구현 범위 불일치

프론트는 `displayName`, `bio`, `expertise` 편집 후 성공 알림을 표시하지만 해당 API는 없다. 반대로 구현된 프로필 이미지 지정 기능과 `profileImageUrl` 응답 필드는 프론트에 연결되지 않았다.

조치 방향:

- 텍스트 편집은 API가 생기기 전까지 비활성화하고 `준비 중`으로 표시하거나 로컬 초안임을 명확히 한다.
- `AuthUser.profileImageUrl`을 계약에 맞추고 asset 업로드 완료 후 `PUT /api/me/profile-image`를 호출하는 UI를 별도 구현한다.

#### 13. 채팅 세션 키 연동과 WebSocket 계약 편차

REST와 실제 WebSocket 전송은 `sessionId` 기준으로 구현됐지만 프론트 소비 코드가 없다. 다시보기의 `lessonId → sessionId` 해석도 미정이다. 또한 `CONTRACT.md`의 WebSocket payload 요약은 실제 백엔드의 `sessionId` 포함·`userId` 제외 구조와 다르다.

조치 방향:

- WebSocket payload 정본을 실제 구현과 맞추고 `lessonId` 병행 유지 여부를 결정한다.
- 라이브 FE는 현재 session route의 `sessionId`로 REST 복구와 WS 구독을 연결한다.
- VOD FE 연동 전에 source session 조회 또는 learning-context 포함 방식으로 `sessionId` 해석 계약을 확정한다.

### 7.3 문서와 현재 화면 구조의 차이

일부 프론트 컴포넌트·API 문서는 별도 라이브 일정 생성·수정 페이지와 일반 세션 상세 페이지를 전제로 한다. 현재 화면은 다음처럼 변경됐다.

- 라이브 일정 생성·수정 → 레슨 생성·수정 화면에 통합
- 라이브 일정과 상태 조회 → 레슨 상세 화면에 통합
- 일반 세션 상세 목적지 → 레슨 상세로 흡수
- 유지되는 session 기반 경로 → 학생 prejoin, 강사 preflight, 강의실, 녹화 처리

관련 문서와 구현을 함께 갱신하지 않으면 상태 분기 책임이 다시 분산될 수 있다.

추가 문서 편차:

- `docs/cp0-open-questions.md`의 1번은 아직 `API_MAP.md`만 `loginId`여서 문서 정합이 남았다고 설명한다. 현재 `API_MAP.md`, `CONTRACT.md`, FE와 BE는 모두 `email`이므로 이 항목은 해결됨으로 닫거나 이메일 정규화처럼 실제 남은 질문만 분리해야 한다.
- 같은 문서의 8번은 WebSocket `userId` 제거와 `clientMessageId` 에코 판별을 설명해 현재 백엔드 구현과 맞지만, 정본 `CONTRACT.md`의 WebSocket payload 요약에는 아직 반영되지 않았다.

관련 파일:

- `docs/frontend/components/LESSON_FORM.md`
- `docs/frontend/components/LESSON_DETAIL.md`
- `docs/frontend/components/LIVE_SESSION.md`
- `frontend/src/pages/LessonFormPage.tsx`
- `frontend/src/pages/LessonDetailPage.tsx`
- `frontend/src/features/lesson/lessonRouting.ts`

## 8. 권장 정리 순서

1. 프론트 레슨 상태 필드를 `lessonStatus`에서 계약 정본인 `status`로 바꾸고 타입, HTTP adapter, mock, 페이지, 테스트를 함께 정렬한다.
2. 커리큘럼 상세 응답에서 `viewerContext`, `allowedActions`, 레슨별 access/live/replay 계약을 확정한다.
3. 라이브 입장 가능 시간과 토큰 발급 상태를 서버에서 강제한다.
4. 강사 preflight 결과와 `/start` 명령을 연결하고 시작 조건을 서버가 최종 검사한다.
5. 레슨 상태를 현재 MVP 직행으로 유지할지 AI 준비 상태기로 전환할지 계약을 하나로 맞춘다.
6. 채팅 WebSocket payload 계약과 VOD의 `lessonId → sessionId` 해석 방식을 확정한 뒤 FE REST·WS 소비를 연결한다.
7. 프로필 텍스트 편집은 미구현 상태를 명확히 하고, 구현된 `profileImageUrl`과 프로필 이미지 지정 API를 FE 인증 모델·UI에 연결한다.
8. 자료 연결과 자료 작업 상태기를 구현하고 프론트 로컬 타이머 표시를 서버 상태 조회로 교체한다.
9. 학습 진도 저장·완료 계산 API를 구현하고 90% 완료 기준과 DB 제약을 일치시킨다.
10. 통합 mock이 종료 상태와 실제 전이를 보존하도록 백엔드 상태기를 따라가게 수정한다.
11. 별도 라이브 세션 페이지를 전제로 한 프론트 문서를 현재 레슨 중심 구조로 갱신한다.
12. 해결된 인증 식별자 질문을 `cp0-open-questions.md`에서 닫고 WebSocket 채팅 결론을 `CONTRACT.md`에 반영한다.

## 9. 상태 해석 원칙

향후 상태 관련 구현과 리뷰에서는 다음을 구분한다.

- enum에 값이 있다는 사실만으로 구현 완료로 판단하지 않는다.
- DB CHECK가 값을 허용하는 것과 서비스가 해당 상태에 도달할 수 있는 것은 다르다.
- mock과 로컬 UI 상태는 서버 권한·보안 판단의 근거로 사용하지 않는다.
- `relationship`, `allowedActions`, 모집 가능 상태는 저장 lifecycle과 분리한다.
- 라이브, 녹화, replay, AI 처리 상태를 하나의 `status`로 합치지 않는다.
- 프론트는 시간을 보고 서버 상태를 임의 변경하지 않고 서버가 반환한 상태와 허용 행동을 따른다.
- 상태 추가·삭제·이름 변경 시 DB, 백엔드 enum, DTO, 프론트 타입, mock, 문서를 같은 변경에서 갱신한다.
