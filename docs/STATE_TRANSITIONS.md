# LiveClass AI 상태와 전이 정리

작성일: 2026-07-20

이 문서는 프론트엔드 화면에서 구분해야 하는 상태 축과 상태 전이를 한곳에 정리한다. 상태 이름이 같더라도 서로 다른 도메인의 상태는 합치지 않는다. 예를 들어 레슨 `PUBLISHED`, 라이브 세션 `LIVE`, 녹화 자산 `READY`, 다시보기 `PUBLISHED`는 각각 독립된 상태다.

## 1. 문서 표기 기준

| 표기 | 의미 |
|---|---|
| 현재 | 백엔드 enum 또는 서비스 전이가 현재 코드에 존재함 |
| 목표 | 프론트엔드 API 명세가 요구하는 최종 상태 모델 |
| 제안 | 이름이나 전이 정책이 아직 공유 계약으로 확정되지 않음 |

프론트엔드는 다음 원칙을 공통으로 적용한다.

- 예정 시각이나 클라이언트 타이머만으로 서버 상태를 바꾸지 않는다.
- 변경 요청 성공 후 서버가 반환한 최신 상태를 사용하고 관련 조회를 갱신한다.
- 버튼 노출과 활성화는 상태 문자열만 조합하기보다 서버의 `allowedActions`를 우선한다.
- `409 *_STATE_CONFLICT`를 받으면 로컬 상태를 유지하지 않고 최신 상세를 다시 조회한다.
- 처리 실패는 해당 축에만 표시한다. AI 또는 녹화 실패가 라이브 세션 자체를 자동 종료시키지 않는다.
- `COMPLETED`, `FAILED` 같은 처리 종료 상태에서는 polling을 멈춘다.

## 2. 전체 상태 축 요약

| 상태 축 | 주요 값 | 전환 주체 | 프론트에서 결정하는 것 |
|---|---|---|---|
| 계정 | `PENDING`, `ACTIVE`, `SUSPENDED`, `WITHDRAWN` | 인증 서버·운영자 | 로그인 가능 여부 |
| 커리큘럼 | `DRAFT`, `PUBLISHED`, `ARCHIVED` | 강사 | 카탈로그 공개와 관리 행동 |
| 수강 | `PENDING`, `ACTIVE`, `REJECTED`, `REVOKED`, `CANCELLED` | 학생·강사·서버 | 학습·라이브·VOD 접근 권한 |
| 레슨 | `DRAFT`, `AI_NOT_READY`, `READY`, `PUBLISHED` | 강사·AI 처리 결과 | 게시, 라이브 준비, 학생 노출 |
| 자료 업로드 | 업로드·검증·활성·삭제·실패 상태 | 브라우저·서버 | 진행률, 재시도, 편집 잠금 |
| 자료 처리 작업 | `QUEUED`부터 `COMPLETED` 또는 `FAILED` | AI worker | polling과 단계 안내 |
| 라이브 세션 | `DRAFT`부터 `ENDED`, `CANCELLED`, `FAILED` | 강사·라이브 오케스트레이터 | 입장, 시작, 종료, 재시도 |
| 녹화 자산 | `REQUESTED`부터 `READY` 또는 `FAILED` | Egress·webhook | 강사 미리보기와 처리 안내 |
| 다시보기 | `DRAFT`, `READY_FOR_REVIEW`, `PUBLISHED`, `WITHDRAWN` | 강사 | 수강생 VOD 공개 여부 |
| AI 게시 콘텐츠 | 준비·검수·초안·게시·실패 상태 | AI worker·강사 | 자막·용어·챕터·퀴즈 노출 |

## 3. 계정 상태

현재 백엔드 enum은 다음 네 상태를 가진다. 다만 회원가입 외 상태 변경 API는 아직 없으므로 아래 나열 순서가 확정 전이를 뜻하지는 않는다.

```text
PENDING · ACTIVE · SUSPENDED · WITHDRAWN
```

| 상태 | 의미 | 프론트 처리 |
|---|---|---|
| `PENDING` | 이메일 인증 등 활성화 전 | 로그인 불가 안내. 인증 기능은 아직 도입 전 |
| `ACTIVE` | 정상 계정 | 로그인 및 역할별 기능 허용 |
| `SUSPENDED` | 운영 정책에 의해 정지 | 로그인 실패를 계정 존재 여부가 드러나지 않는 방식으로 처리 |
| `WITHDRAWN` | 탈퇴 계정 | 로그인 불가, 개인정보·학습 기록 정책은 별도 결정 필요 |

현재 회원가입은 이메일 인증 흐름이 없어 바로 `ACTIVE`로 생성된다. `PENDING`, `SUSPENDED`, `WITHDRAWN` 전환 API와 전용 화면은 아직 프론트 연동 범위가 아니다.

## 4. 커리큘럼 lifecycle

현재 백엔드가 구현한 전이는 다음과 같다.

```text
DRAFT ──게시──→ PUBLISHED ──보관──→ ARCHIVED
```

| 상태 | 의미 | 카탈로그 | 강사 화면 |
|---|---|---|---|
| `DRAFT` | 기본 정보와 구조를 작성하는 초안 | 미노출 | 편집·게시 가능 |
| `PUBLISHED` | 공식 공개된 커리큘럼 | 노출 | 운영·보관 가능 |
| `ARCHIVED` | 운영을 마치고 보관 | 미노출 | 읽기 위주, 복구 정책 미정 |

- 게시 명령은 현재 `DRAFT → PUBLISHED`에서만 허용한다.
- 보관 명령은 현재 `PUBLISHED → ARCHIVED`에서만 허용한다.
- `ARCHIVED → PUBLISHED` 복구와 삭제는 현재 범위 밖이다.
- 커리큘럼 공개와 레슨 공개는 별개다. 커리큘럼이 `PUBLISHED`여도 학생 목차에는 `PUBLISHED` 레슨만 노출한다.

## 5. 수강 상태

현재 프론트엔드 초안은 모든 커리큘럼을 **강사 승인 후 수강** 방식으로 운영한다. 따라서 일반 신청은 항상 `PENDING`으로 생성되고 강사의 승인 이후에만 `ACTIVE`가 된다. enum은 백엔드에 존재하지만 신청·승인 API의 전체 연동은 아직 남아 있다.

```text
                    ┌──승인──→ ACTIVE ──권한 회수──→ REVOKED
신청 생성 ──→ PENDING
                    ├──거절──→ REJECTED
                    └──취소──→ CANCELLED
```

| 상태 | 의미 | 학생 행동 |
|---|---|---|
| `PENDING` | 수강 승인 대기 | 신청 취소 가능, 보호 레슨 접근 불가 |
| `ACTIVE` | 유효한 수강 권한 | 게시 레슨·라이브·VOD에 조건부 접근 가능 |
| `REJECTED` | 강사가 신청을 거절 | 접근 불가, 재신청 정책 미정 |
| `REVOKED` | 기존 수강 권한 회수 | 신규 재생 URL·SSE·학습 요청 중단 |
| `CANCELLED` | 승인 전 신청 취소 | 접근 불가, 재신청 정책 미정 |

수강 방식은 상태가 아니라 신청 상태의 생성 규칙이다. 현재 커리큘럼 생성 UI에서는 `APPROVAL_REQUIRED`만 선택된 고정값으로 사용하며 다른 방식은 노출하지 않는다.

| 수강 방식 | 현재 지원 | 생성 결과 |
|---|---|---|
| `APPROVAL_REQUIRED` | 지원 | `PENDING` 생성 후 강사 승인 필요 |
| `IMMEDIATE` | 미지원 | 프론트 생성 UI에서 노출하지 않음 |
| `INVITATION_ONLY` | 미지원 | 프론트 생성 UI에서 노출하지 않음 |

현재 프론트엔드에서 다루는 기본 전이는 `PENDING → ACTIVE`, `PENDING → REJECTED`, `PENDING → CANCELLED`다. 신청을 승인 없이 바로 `ACTIVE`로 만드는 흐름은 제공하지 않는다. `ACTIVE → REVOKED`는 학습 기록과 재생 권한 회수 정책을 먼저 확정해야 한다.

## 6. 레슨 상태

목표 상태 흐름은 다음과 같다.

```text
DRAFT ──AI 준비 시작──→ AI_NOT_READY ──필수 처리 완료──→ READY ──명시적 게시──→ PUBLISHED
                              ↑                                            │
                              └──────── 게시 후 자료 추가·삭제 ────────────┘
```

| 상태 | 의미 | 강사 행동 | 학생 접근 |
|---|---|---|---|
| `DRAFT` | 제목·설명·초기 자료를 작성 중 | 기본 정보·자료 편집, AI 준비 시작 | 불가 |
| `AI_NOT_READY` | 필수 PPTX 검증 또는 AI 작업이 미완료 | 진행 확인·실패 재시도 | 불가 |
| `READY` | 필수 자료와 AI 처리가 끝남 | 검토 후 게시 | 불가 |
| `PUBLISHED` | 강사가 공식 게시 | 세션 생성·라이브 준비 | 게시 레슨과 활성 자료 접근 가능 |

핵심 규칙은 다음과 같다.

- `READY`가 되어도 자동 게시하지 않는다. 강사의 게시 명령이 있어야 `PUBLISHED`가 된다.
- 자료 없이 `DRAFT` 저장은 가능하지만 게시와 라이브 시작은 차단한다.
- `AI_NOT_READY`에서는 라이브 시작을 차단한다.
- `PUBLISHED` 레슨의 자료를 추가하거나 삭제하면 `AI_NOT_READY`로 되돌리고, 처리가 끝난 뒤 `READY → PUBLISHED` 재게시를 요구한다.
- 라이브 중에는 레슨 전체 편집을 잠그고, 종료 후 초기 범위에서는 제목·설명만 수정한다.
- 현재 백엔드는 레슨 생성·수정 시 `DRAFT`를 사용한다. PPTX/AI 준비와 `READY → PUBLISHED` 전환 API는 목표 명세이며 추가 구현이 필요하다.

## 7. 레슨 자료와 처리 작업

자료에는 브라우저 업로드 상태, 서버 자산 상태, 레슨에 연결된 자료 상태, AI 처리 작업 상태가 섞일 수 있으므로 필드를 분리해야 한다.

### 7.1 업로드·자료 상태

프론트 명세의 세부 흐름 제안은 다음과 같다.

```text
PENDING_UPLOAD → UPLOADING → UPLOADED → VALIDATING → ACTIVE
                                   ├──→ VALIDATION_FAILED
                                   └──→ FAILED

ACTIVE → DELETING → DELETED
```

| 상태 | 소유 주체 | 프론트 처리 |
|---|---|---|
| `PENDING_UPLOAD` | 서버 또는 업로드 세션 | 업로드 준비 표시 |
| `UPLOADING` | 브라우저 | 진행률과 이탈 경고 표시 |
| `UPLOADED` | 서버 | 검증 대기 표시 |
| `VALIDATING` | 서버 | 조작 잠금, 상태 조회 |
| `VALIDATION_FAILED` | 서버 | 파일 오류와 재선택 안내 |
| `ACTIVE` | 서버 | 레슨 자료로 사용 가능 |
| `DELETING` | 서버 | 삭제 처리 중, 중복 요청 차단 |
| `DELETED` | 서버 | 목록에서 제거 |
| `FAILED` | 서버 | 일반 실패, 재시도 제공 여부 확인 |

현재 백엔드 모델은 더 단순하다.

- 공용 자산: `PENDING`, `UPLOADED`, `FAILED`, `DELETED`
- 레슨 자료: `ACTIVE`, `DELETING`, `DELETED`

따라서 세부 `uploadStatus`를 서버 enum으로 확정할지, `UPLOADING`만 프론트 로컬 상태로 둘지 계약 합의가 필요하다.

### 7.2 자료 처리 작업

목표 처리 단계는 다음과 같다.

```text
QUEUED → VALIDATING → PARSING → CHUNKING → EMBEDDING
      → GENERATING_CANDIDATES → COMPLETED

삭제 작업: QUEUED → REMOVING_EMBEDDINGS → INVALIDATING_AI_RESULTS → COMPLETED
각 단계 ──오류──→ FAILED
```

- `stage` 또는 `processingStatus`는 사용자 안내용이다.
- 행동 가능 여부는 최종 `lessonStatus`, `operationStatus`, `allowedActions`로 결정한다.
- 처리 중에는 2~5초 polling으로 시작하고 장기 작업은 backoff한다.
- `COMPLETED`, `FAILED`에서 polling을 중단한다.
- 작업 실패 시 기존 활성 자료와 기존 검색 범위를 가능한 한 유지한다.

## 8. 라이브 세션 상태

목표 비동기 상태 흐름은 다음과 같다.

```text
DRAFT → SCHEDULED → OPEN → STARTING → LIVE → ENDING → ENDED
  │         │         │        └──실패──→ FAILED
  └─────────┴─────────┴──취소──────────→ CANCELLED
```

| 상태 | 의미 | 대표 화면·행동 |
|---|---|---|
| `DRAFT` | 일정이 확정되지 않은 초안 | 일정 편집·삭제·취소 |
| `SCHEDULED` | 일정 확정 | 일정 수정·사전 점검 |
| `OPEN` | 서버 정책상 입장 가능한 구간 | 학생 prejoin·강사 시작 준비 |
| `STARTING` | LiveKit room, Egress, STT 등을 기동 중 | 중복 시작 차단, 상세 재조회 |
| `LIVE` | 실제 라이브 진행 중 | 강의실 입장·운영·종료 |
| `ENDING` | room과 연동 서비스를 종료 중 | 종료 중 안내, 중복 종료 차단 |
| `ENDED` | 라이브 세션 종료 확정 | 녹화·AI 후처리 화면으로 이동 |
| `CANCELLED` | 시작 전 취소 | 입장·시작 불가 |
| `FAILED` | 시작 또는 오케스트레이션 실패 | 원인 표시, 재시도 정책 미정 |

현재 백엔드는 외부 오케스트레이션 전 단계라 아래처럼 중간 상태를 건너뛴다.

```text
DRAFT/SCHEDULED/OPEN → LIVE → ENDED
DRAFT/SCHEDULED/OPEN → CANCELLED
```

- 목표 구현에서는 `STARTING`, `ENDING`을 서버가 관리한다.
- 프론트는 `STARTING` timeout만으로 `FAILED`로 바꾸지 않고 상세를 재조회한다.
- `OPEN`을 저장 상태로 둘지 현재 시각과 정책으로 계산할지는 아직 결정이 필요하다. 권장안은 서버 계산이다.
- `FAILED` 세션을 재시도할지 새 세션을 만들지는 정책 결정이 필요하다.

## 9. 녹화 자산 상태

라이브 세션과 녹화 자산은 독립적으로 움직인다.

```text
REQUESTED → STARTING → RECORDING → FINALIZING → VERIFYING → READY
     └──────────── 각 기동·처리 단계 오류 ───────────────→ FAILED
```

| 상태 | 의미 | 프론트 처리 |
|---|---|---|
| `REQUESTED` | 녹화 생성 요청 저장 | 준비 중 |
| `STARTING` | Egress 기동 중 | 준비 중, 중복 시작 차단 |
| `RECORDING` | 녹화 진행 중 | 라이브 화면에 녹화 상태 표시 |
| `FINALIZING` | 세션 종료 후 HLS 마무리 | 다시보기 준비 중 |
| `VERIFYING` | playlist·segment 검증 중 | 다시보기 준비 중 |
| `READY` | 재생 가능한 HLS 자산 확인 완료 | 강사 미리보기·검수 가능 |
| `FAILED` | 녹화 또는 처리 실패 | 라이브와 분리해 실패 안내 |

현재 백엔드는 `REQUESTED → RECORDING → FINALIZING`과 시작 실패 시 `FAILED`까지 구현한다. `FINALIZING → VERIFYING → READY`는 Egress 완료 webhook 연동이 추가되어야 한다. 현재 시작 성공 경로는 `STARTING`을 실질적으로 건너뛴다.

`videoAssetStatus=READY`는 파일이 재생 가능하다는 뜻일 뿐 학생 공개를 뜻하지 않는다.

## 10. 다시보기 공개 상태

```text
DRAFT → READY_FOR_REVIEW → PUBLISHED → WITHDRAWN
```

| 상태 | 의미 | 강사 | 학생 |
|---|---|---|---|
| `DRAFT` | 녹화 생성 시 만들어진 공개 초안 | 처리 상태 확인 | 재생 불가 |
| `READY_FOR_REVIEW` | 영상 자산 준비가 끝나 검수 가능 | 미리보기·검수·게시 | 재생 불가 |
| `PUBLISHED` | 강사가 다시보기를 게시 | 관리·공개 중단 | 조건 충족 시 재생 가능 |
| `WITHDRAWN` | 공개 중단 | 재게시 정책 미정 | 신규 재생 불가 |

학생 VOD 접근은 최소한 다음 조건을 모두 만족해야 한다.

```text
lessonStatus=PUBLISHED
+ enrollmentStatus=ACTIVE
+ videoAssetStatus=READY
+ replayStatus=PUBLISHED
```

실제 허용 여부는 서버의 접근 검사와 `allowedActions`를 따른다. 이미 발급된 재생 URL을 `WITHDRAWN` 또는 `REVOKED` 시 즉시 무효화할지는 TTL 정책과 함께 확정해야 한다.

## 11. AI 후처리와 게시 콘텐츠 상태

AI 상태도 처리 상태와 사용자 공개 상태를 분리한다.

### 11.1 후처리 요약 상태

라이브 종료 후 자막·용어·챕터·퀴즈는 각각 독립적으로 다음 상태를 가진다.

```text
NOT_STARTED → PROCESSING → READY
                    └──→ FAILED
```

- 한 영역의 실패를 전역 AI 실패로 합치지 않는다.
- AI 실패가 영상 재생이나 이미 게시된 다른 영역을 중단시키지 않는다.
- `READY`는 결과 생성 완료를 뜻하며 자동 공개를 뜻하지 않는다.

### 11.2 영역별 검수·게시 상태 제안

적용 영역은 `TRANSCRIPT`, `GLOSSARY`, `CHAPTERS`, `QUIZ`다.

```text
NOT_READY → PROCESSING → READY_FOR_REVIEW → DRAFT_SAVED → PUBLISHED
                 └──────────── 오류 ────────────────→ FAILED
```

| 상태 | 의미 | 노출 규칙 |
|---|---|---|
| `NOT_READY` | 후보가 아직 없음 | 숨김 또는 준비 중 |
| `PROCESSING` | AI 후보 생성 중 | 처리 중 표시 |
| `READY_FOR_REVIEW` | 강사 검수 가능 | 학생에게 미노출 |
| `DRAFT_SAVED` | 강사가 수정 초안을 저장 | 기존 게시본이 있으면 기존 버전 유지 |
| `PUBLISHED` | 강사가 특정 버전을 게시 | 해당 영역만 학생에게 노출 |
| `FAILED` | 해당 영역 처리 실패 | 영상과 다른 게시 영역 유지 |

새 버전 게시 실패 시 기존 활성 게시본을 유지한다. 영상은 AI 영역이 게시되지 않아도 `videoAssetStatus=READY`와 `replayStatus=PUBLISHED`를 만족하면 재생할 수 있다.

## 12. 화면 진입을 결정하는 대표 조합

| 사용자 행동 | 필요한 상태 조합 | 비고 |
|---|---|---|
| 공개 커리큘럼 조회 | 커리큘럼 `PUBLISHED` | 공개 목록·상세는 그 외 상태를 노출하지 않음 |
| 레슨 게시 | 레슨 `READY` | 강사의 명시적 게시 명령 필요 |
| 라이브 시작 | 레슨 `PUBLISHED` + 필수 자료 존재 + AI 준비 완료 + 진행 중 자료 작업 없음 + 세션 `SCHEDULED` 또는 `OPEN` + preflight 통과 | 최종 판단은 서버 |
| 학생 라이브 입장 | 수강 `ACTIVE` + 입장 가능한 세션 상태 | token 발급 결과와 `allowedActions` 사용 |
| 강사 VOD 미리보기 | 녹화 자산 `READY` | replay 게시 전에도 가능 |
| 학생 VOD 재생 | 레슨 `PUBLISHED` + 수강 `ACTIVE` + 녹화 자산 `READY` + replay `PUBLISHED` | 네 축을 모두 확인 |
| AI 콘텐츠 노출 | 해당 영역 `PUBLISHED` | 영역별 독립 노출 |

예를 들어 라이브 종료 직후의 정상 조합은 아래처럼 여러 상태가 동시에 존재할 수 있다.

```text
lessonStatus       = PUBLISHED
liveSessionStatus  = ENDED
videoAssetStatus   = FINALIZING
replayStatus       = DRAFT
transcriptStatus   = PROCESSING
quizStatus         = NOT_STARTED
```

이 조합은 모순이 아니다. 레슨은 게시 상태를 유지하고, 라이브는 끝났으며, 녹화와 AI는 별도로 후처리 중인 상태다.

## 13. 상태처럼 보이지만 별도로 다룰 값

- `APPROVAL_REQUIRED`는 수강 상태가 아니라 현재 고정된 수강 방식이다. 백엔드 enum에는 `IMMEDIATE`, `INVITATION_ONLY`도 남아 있지만 현재 프론트 생성 UI에서는 지원하지 않는다.
- `GUEST`, `UNENROLLED_STUDENT`, `PENDING_ENROLLMENT`, `ENROLLED`, `OWNER_INSTRUCTOR`, `NON_OWNER_INSTRUCTOR`는 저장 lifecycle이 아니라 현재 사용자의 관계를 계산한 `viewerContext.relationship`이다.
- `OPEN`, `NOT_OPEN` 같은 모집 가능 여부는 커리큘럼 lifecycle과 분리된 모집 상태다. 날짜 기반 계산 주체와 최종 enum은 미확정이다.
- `loading`, `authenticated`, `guest`는 프론트 인증 조회를 위한 UI 로컬 상태이며 서버 도메인 상태가 아니다.
- `강사 운영 모드`, `강사 검수 모드`는 classroom·replay에서 역할에 따라 렌더링하는 화면 모드이며 라이브나 replay 상태가 아니다. 실제 연동에서는 해당 커리큘럼 소유권과 서버 `allowedActions`로 결정한다.
- 대표 이미지의 선택·미리보기·삭제는 현재 브라우저 폼 상태다. 업로드 API가 연결되기 전까지 서버 자산 lifecycle로 간주하지 않는다.
- outbox·inbox 메시지 상태는 내부 연동 복구용이며 프론트 API에 노출하지 않는다.

## 14. 아직 확정해야 할 전이

1. 게시된 레슨의 자료 변경 시 학생 공개를 즉시 중단할 정확한 시점

   - **권장안:** 현재 학생에게 공개 중인 게시 revision은 유지하고, 자료 변경은 별도의 작업 revision을 `AI_NOT_READY`로 만든다. AI 처리가 끝난 뒤 강사가 재게시하면 활성 revision을 원자적으로 교체한다.
   - 기존 게시본을 즉시 내리면 정상 학습과 예정된 라이브가 자료 편집 때문에 갑자기 중단될 수 있다. 라이브와 학생 화면은 재게시 전까지 기존 활성 revision만 사용하고, 강사 화면에는 “공개 중인 버전”과 “수정 중인 버전”을 구분해 표시한다.

2. 자료 업로드의 서버 enum 범위와 브라우저 전용 `UPLOADING` 분리 방식

   - **권장안:** 파일 선택·읽기·전송 진행률인 `SELECTED`, `READING`, `UPLOADING`은 브라우저 로컬 상태로만 관리한다. 서버는 업로드 세션을 만든 시점부터 `PENDING_UPLOAD`, `UPLOADED`, `VALIDATING`, `ACTIVE`, `DELETING`, `DELETED`, `FAILED`를 관리한다.
   - 네트워크가 끊긴 브라우저의 진행 상태를 서버 enum과 섞지 않는다. 프론트는 업로드 완료 통지 후 서버 상태를 다시 조회하고, 페이지 재진입 시에는 서버 상태만으로 화면을 복원한다.

3. `OPEN`을 저장할지 서버가 시각·정책으로 계산할지

   - **권장안:** `OPEN`은 DB에 저장하지 않고 서버가 현재 시각, 예정 시각, 입장 가능 시간, 취소 여부를 기준으로 계산한다. 장기적으로는 라이브 lifecycle과 분리된 `entryStatus=NOT_OPEN|OPEN|CLOSED` 필드로 제공한다.
   - 시간 경과만으로 바뀌는 값을 저장하면 별도 스케줄러와 상태 보정 작업이 필요하다. 프론트는 로컬 시각으로 입장을 열지 않고 서버 응답의 `entryStatus`와 `allowedActions`만 사용한다.

4. 라이브 `FAILED` 재시도와 새 세션 생성 중 어떤 방식을 사용할지

   - **권장안:** `STARTING` 중 일시적인 LiveKit·Egress·STT 기동 실패는 같은 `sessionId`에서 멱등 재시도한다. 서버가 `attempt`를 증가시키고 재시도 가능한 경우에만 `RETRY_START`를 `allowedActions`로 반환한다.
   - 한 번이라도 `LIVE`가 되었거나 녹화 자산·시간축이 생성된 세션은 재사용하지 않는다. 종료 후 재수업이 필요하면 새 세션을 만들고 기존 실패·종료 세션은 이력으로 보존한다.

5. `ACTIVE → REVOKED` 시 학습 기록과 기존 재생 URL 처리

   - **권장안:** 진도, 퀴즈 응시, 북마크 같은 학습 기록은 감사와 복구를 위해 보존하고 접근 권한만 즉시 회수한다. 신규 HLS URL, LiveKit token, SSE·학습 요청 발급은 바로 차단한다.
   - 이미 발급된 HLS URL은 짧은 TTL을 기본으로 하고 만료 이후 재발급을 거부한다. 즉시 차단이 반드시 필요한 경우에만 CDN·미디어 게이트의 별도 폐기 기능을 사용하며, 프론트는 `REVOKED` 확인 즉시 재생과 실시간 연결을 종료한다.

6. replay `WITHDRAWN → PUBLISHED` 재게시 허용 여부

   - **권장안:** 영상 자산이 여전히 `READY`이고 기존 게시본을 그대로 다시 공개하는 경우에는 `WITHDRAWN → PUBLISHED`를 허용한다. 확인 대화상자와 게시·철회 이력은 반드시 남긴다.
   - 철회 중 영상이나 AI 콘텐츠가 변경됐다면 기존 상태를 바로 되돌리지 않고 새 검수 revision을 만든다. 검수가 끝난 뒤 새 버전을 게시하며 기존 학습·퀴즈 기록은 삭제하지 않는다.

7. 영역별 AI 처리 `READY`와 검수 `READY_FOR_REVIEW`의 DTO 경계

   - **권장안:** AI 작업의 기술 상태와 core 게시 상태를 별도 필드로 분리한다. 예를 들어 `processingStatus=NOT_STARTED|PROCESSING|READY|FAILED`, `publicationStatus=NOT_READY|READY_FOR_REVIEW|DRAFT_SAVED|PUBLISHED`를 사용한다.
   - AI worker 결과가 준비돼 core 후보로 정상 반영되면 `processingStatus=READY`, `publicationStatus=READY_FOR_REVIEW` 조합이 된다. 프론트는 처리 진행 안내에는 전자를, 강사 검수·학생 노출 판단에는 후자와 `allowedActions`를 사용한다.

8. 모집 상태 enum과 커리큘럼 lifecycle의 조합 규칙

   - **권장안:** 모집 가능 여부는 커리큘럼 lifecycle과 분리된 `enrollmentStatus=NOT_OPEN|OPEN|CLOSED`로 서버가 계산한다. 현재 수강 방식은 `APPROVAL_REQUIRED`로 고정하고 `PUBLISHED + OPEN`일 때만 신청을 허용한다.
   - `DRAFT`와 `ARCHIVED`는 모집 기간과 관계없이 항상 `NOT_OPEN` 또는 `CLOSED`로 응답한다. `PUBLISHED`에서는 모집 시작·종료 시각과 운영 정책으로 상태를 계산하고, 최종 신청 가능 여부는 `allowedActions`의 `ENROLL`로 제공한다.

결정이 API 필드, enum, 상태코드 또는 URL을 바꾸면 [공유 계약](../CONTRACT.md), 관련 API 명세와 FE/BE 계약 테스트를 함께 갱신한다.

## 15. 관련 문서

- [전체 페이지 명세](PAGES.md)
- [레슨·자료 API](api/LESSON_MANAGEMENT.md)
- [라이브 API](api/LIVE.md)
- [VOD·AI API](api/VOD_LEARNING_AI.md)
- [커리큘럼 상세·수강 API](api/CURRICULUM_DETAIL.md)
- [커리큘럼 관리 API](api/CURRICULUM_MANAGEMENT.md)
- [결정 필요 항목](DECISIONS_PENDING.md)
