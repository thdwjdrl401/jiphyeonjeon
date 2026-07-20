# LiveClass AI — 라이브 세션 준비·상세 컴포넌트

> 컴포넌트 원칙: [README.md](README.md) · 레슨 상세: [LESSON_DETAIL.md](LESSON_DETAIL.md) · 라이브 강의실: [LIVE_LESSON.md](LIVE_LESSON.md) · 페이지 기준: [PAGES.md](../PAGES.md)

## 1. 범위와 목적

live session은 lesson에 연결된 실제 일정·입장·진행·종료 인스턴스다. 이 문서는 다음 화면을 함께 정의한다.

- 강사용 라이브 세션 생성·수정
- 공통 라이브 세션 상세
- 수강생 입장 전 점검
- 강사 사전 점검
- 강사용 녹화 처리 현황

라이브 강의실 자체는 [LIVE_LESSON.md](LIVE_LESSON.md), lesson 게시·자료 관리는 [LESSON_DETAIL.md](LESSON_DETAIL.md)에서 다룬다.

## 2. 확정 원칙

- lesson과 live session은 별도 ID와 상태를 사용
- MVP에서는 `lesson : liveSession = 1:1`
- 세션 화면·API·실시간 연결의 기준 식별자는 `sessionId`
- lesson 게시·AI 준비 전에도 세션 예약은 가능
- 실제 시작은 `lessonStatus=PUBLISHED`와 AI 준비 완료를 필수로 요구
- 강사가 수동으로 시작하며 예정 시각만으로 자동 시작하지 않음
- 시작 전 LiveKit·Egress·STT 문제는 시작 차단
- 시작 성공 후 Egress·STT 장애는 WebRTC 라이브를 종료시키지 않고 저하 상태로 처리
- 학생 토큰은 미디어 subscribe-only
- 라이브 종료와 Egress 완료를 별도 상태로 관리

## 3. 상태 모델

```text
DRAFT → SCHEDULED → OPEN → STARTING → LIVE → ENDING → ENDED
   └──────────────→ CANCELLED
STARTING ─────────→ FAILED
```

| 상태 | 의미 | 주요 행동 |
|---|---|---|
| `DRAFT` | 일정 작성 중 | 강사 수정·삭제 |
| `SCHEDULED` | 일정 검증·예약 완료 | 강사 변경·취소, 수강생 일정 확인 |
| `OPEN` | 입장 가능 창 시작 | prejoin·preflight, 조건 충족 시 시작 |
| `STARTING` | room·Egress·token 시작 제어 중 | 중복 시작 방지·결과 대기 |
| `LIVE` | 강사 송출과 수업 진행 | 입장·채팅·자막·AI·종료 |
| `ENDING` | 신규 입장 차단·종료 제어 중 | 중복 종료 수렴·처리 상태 확인 |
| `ENDED` | 라이브 종료 확정 | 녹화 처리·다시보기 준비 확인 |
| `CANCELLED` | 시작 전 취소 | 취소 사유 확인 |
| `FAILED` | room 시작 제어 실패 | 재시도 가능 여부·새 세션 정책 안내 |

프론트는 예정 시각만으로 상태를 바꾸지 않고 서버가 제공한 상태와 허용 행동을 사용한다.

## 4. 페이지와 라우트

| 화면 | 라우트 | 접근 |
|---|---|---|
| 세션 생성 | `/instructor/lessons/:lessonId/live-sessions/new` | 해당 lesson 강사 |
| 세션 수정 | `/instructor/live-sessions/:sessionId/edit` | 해당 세션 강사 |
| 세션 상세 | `/live-sessions/:sessionId` | 해당 강사·수강생 |
| 수강생 prejoin | `/live-sessions/:sessionId/prejoin` | 입장 권한 수강생 |
| 강사 preflight | `/instructor/live-sessions/:sessionId/preflight` | 해당 세션 강사 |
| 라이브 강의실 | `/live-sessions/:sessionId/classroom` | 유효 입장 권한 |
| 녹화 처리 | `/instructor/live-sessions/:sessionId/processing` | 해당 세션 강사 |

## 5. 컴포넌트 트리

```text
LiveSessionFormPage
└─ WorkspaceLayout
   └─ LiveSessionForm
      ├─ ScheduledAtField
      ├─ ExpectedDurationField
      ├─ EntryWindowField
      ├─ RecordingPolicyNotice
      └─ LiveSessionFormActions

LiveSessionDetailPage
└─ WorkspaceLayout
   ├─ LiveSessionHeader
   ├─ LiveSessionScheduleCard
   ├─ LiveSessionStatusCard
   ├─ RecordingNotice
   ├─ LessonReadinessSummary
   └─ RoleBasedSessionActions

StudentPrejoinPage
└─ WorkspaceLayout
   └─ StudentPrejoinPanel
      ├─ SpeakerCheck
      ├─ AutoplayCheck
      ├─ NetworkCheck
      ├─ DisplayNameConfirm
      ├─ RecordingConsentNotice
      └─ JoinClassroomAction

InstructorPreflightPage
└─ WorkspaceLayout
   └─ InstructorPreflightPanel
      ├─ CameraPreview
      ├─ MicrophoneCheck
      ├─ NetworkCheck
      ├─ LessonAiReadinessCheck
      ├─ LiveKitReadinessCheck
      ├─ EgressReadinessCheck
      ├─ SttReadinessCheck
      └─ StartLiveSessionAction

LiveSessionProcessingPage
└─ WorkspaceLayout
   ├─ SessionEndSummary
   ├─ VideoAssetProcessingSteps
   ├─ AiPostProcessingSummary
   ├─ ProcessingRecoveryActions
   └─ ReplayReviewEntry
```

## 6. 컴포넌트 책임

| 컴포넌트 | 소유 영역 | 책임 |
|---|---|---|
| `LiveSessionFormPage` | `pages` | lesson·소유권·기존 세션 확인과 생성·수정 모드 조합 |
| `LiveSessionForm` | `features/live-session` | 일정·입장 창 검증과 저장 상태 관리 |
| `LiveSessionDetailPage` | `pages` | session 상태와 역할별 대표 행동 조합 |
| `LiveSessionStatusCard` | `features/live-session` | 서버 상태·차단 사유·다음 행동 표시 |
| `LessonReadinessSummary` | `features/lesson` | lesson 게시·자료·AI 준비 상태 요약 |
| `StudentPrejoinPanel` | `features/live-session` | 수신 환경 점검과 입장 token 요청 준비 |
| `InstructorPreflightPanel` | `features/live-session` | 시작 전 필수·경고 점검 조합 |
| `StartLiveSessionAction` | `features/live-session` | 멱등 시작 요청과 성공 시 classroom 이동 |
| `LiveSessionProcessingPage` | `pages` | 종료 세션·Egress·HLS·AI 후처리 상태 조합 |
| `VideoAssetProcessingSteps` | `features/replay` | 녹화 자산의 단계·실패·재검증 상태 표시 |

## 7. 세션 생성·수정

### 7.1 입력

- 예정 시작 시각: 필수, 시간대가 명확한 API 값 사용
- 예상 진행 시간: 선택
- 입장 가능 창: 서버 기본값 또는 허용 범위에서 설정
- 녹화 고지: 항상 활성화되는 정책 안내이며 녹화 비활성 토글이 아님

lesson 제목·자료·AI 정책은 세션 폼에서 수정하지 않는다.

### 7.2 생성

1. `lessonId`와 소유권 확인
2. 기존 live session 존재 여부 확인
3. 일정 입력·검증
4. `DRAFT` 저장 또는 예약 확정
5. 서버에서 `sessionId` 생성
6. `SCHEDULED` 상세로 이동

MVP 1:1 제약으로 기존 세션이 있으면 새 세션 생성을 차단하고 기존 세션으로 연결한다.

### 7.3 수정·취소

- `DRAFT`·`SCHEDULED`에서 일정 수정
- `OPEN` 이후 수정 가능 범위는 서버 허용 행동 사용
- `STARTING` 이후 일정 수정·취소 차단
- 동일 강사의 일정 충돌은 서버 검증 결과 표시
- 취소 시 영향과 수강생 노출 범위를 확인한 뒤 실행

## 8. 라이브 세션 상세

### 8.1 접근 권한

- 해당 lesson 강사는 lesson 게시 상태와 관계없이 자신의 session 상세·수정·점검에 접근
- 수강생은 유효한 enrollment와 `lessonStatus=PUBLISHED`를 모두 만족할 때만 session 상세·prejoin에 접근
- 비로그인·미수강자·다른 강사는 진입 단계에서 차단
- 실제 권한과 상태는 모든 session API와 LiveKit token 발급에서 서버가 다시 검증

### 8.2 공통 표시

- lesson·curriculum 정보
- 예정 시각·예상 시간·입장 가능 시각
- 녹화·자막·채팅·AI 사용 고지
- 세션 상태와 상태별 안내
- lesson 게시·자료·AI 준비 상태

### 8.3 강사 행동

| session 상태 | 대표 행동 |
|---|---|
| `DRAFT` | 일정 계속 작성 |
| `SCHEDULED` | 일정 수정·취소·사전 점검 |
| `OPEN` | 사전 점검·시작 |
| `STARTING` | 시작 결과 대기 |
| `LIVE` | 라이브 운영 |
| `ENDING` | 종료 결과·처리 상태 확인 |
| `ENDED` | 녹화 처리 현황 |
| `CANCELLED` | 취소 상태 확인 |
| `FAILED` | 실패 원인·허용된 복구 확인 |

### 8.4 수강생 행동

| session 상태 | 대표 행동 |
|---|---|
| `DRAFT` | 노출하지 않음 |
| `SCHEDULED` | 일정·카운트다운 확인 |
| `OPEN` | 입장 전 점검 |
| `STARTING` | 강사 시작 대기 |
| `LIVE` | 입장 전 점검 필수 |
| `ENDING` | 종료 처리 안내 |
| `ENDED` | 다시보기 준비 상태 |
| `CANCELLED` | 취소 안내 |
| `FAILED` | 진행 불가 안내 |

## 9. 수강생 입장 전 점검

- 인증·수강·`sessionId`·입장 가능 상태 확인
- 스피커 테스트
- 브라우저 autoplay 가능 여부 확인
- 네트워크 품질 경고
- 표시명 또는 세션 가명 확인
- 녹화·자막·채팅·AI 사용 고지
- 카메라·마이크 권한 요청 없음
- token 요청 실패와 LiveKit 연결 실패 구분

점검을 통과해도 session이 `LIVE`가 아니면 classroom 연결 대신 시작 대기 상태를 유지한다.

수강생은 `OPEN`과 `LIVE` 모두 prejoin을 먼저 거친다. 프론트는 점검 완료 문맥 없이 `/live-sessions/:sessionId/classroom`으로 직접 접근한 수강생을 같은 세션의 prejoin으로 되돌린다. 이 클라이언트 가드는 보안 판정을 대신하지 않으며 LiveKit token 발급 시 서버가 수강 권한과 세션 상태를 다시 검증한다.

## 10. 강사 사전 점검과 시작 차단

### 10.1 필수 차단 조건

- lesson이 `PUBLISHED`가 아님
- 필수 PPTX 없음
- AI 준비 미완료 또는 실패
- 자료 추가·삭제 작업 진행 중
- session이 `SCHEDULED` 또는 `OPEN`이 아님
- 강사 소유권 없음
- 카메라·마이크 필수 권한 또는 장치 없음
- LiveKit room 시작 불가
- Egress 시작 또는 저장 경로 준비 불가
- 실시간 STT 준비 불가

AI 미준비와 Egress 문제는 경고만 표시하고 우회하는 선택지를 제공하지 않는다.

### 10.2 시작

1. 최신 preflight 결과 확인
2. 강사 확인
3. 멱등 시작 요청
4. `STARTING` 표시와 중복 실행 차단
5. 성공한 `sessionId`로 classroom 이동
6. 다른 탭에서 이미 시작했다면 기존 LIVE 세션으로 연결

시작 후 Egress나 STT가 실패하면 classroom의 degraded 정책으로 전환하고 WebRTC 라이브는 유지한다.

## 11. 종료와 녹화 처리

- 강사 종료 요청 시 `ENDING`
- 신규 학생 입장 차단
- LiveKit room 종료와 Egress stop/finalize 별도 추적
- room 종료가 확인되면 session `ENDED`
- video asset은 `FINALIZING → VERIFYING → READY` 또는 `FAILED`
- AI 후처리 상태는 video asset과 별도 표시
- 자산 `READY` 후 강사 VOD 미리보기·검수 진입
- replay 게시 전 수강생 재생 불가

종료 후 잃어버린 미디어를 업로드로 대체하는 버튼은 제공하지 않는다.

## 12. 페이지 상태와 실패 처리

- 인증·권한 확인 중 역할별 행동을 먼저 노출하지 않음
- 일정 저장 중 중복 제출 방지
- `STARTING`·`ENDING` timeout을 성공이나 실패로 임의 확정하지 않음
- 상태 충돌은 최신 session 재조회 후 허용 행동 갱신
- Egress 처리 지연은 빈 플레이어 대신 단계 표시
- 5xx·네트워크 장애와 권한·상태 충돌을 구분

## 13. 필요한 데이터와 연결

정확한 필드와 API는 [API_MAP.md](../API_MAP.md)에서 확정한다.

- `sessionId`·`lessonId`
- curriculum·section·lesson 요약
- `lessonStatus`·자료·AI 준비 상태
- live session 예정 시각·입장 창·상태
- 현재 사용자의 관계와 허용 행동
- prejoin·preflight 점검 결과와 차단·경고 구분
- LiveKit token 발급 가능 여부
- video asset 상태·attempt·실패 사유
- replay 상태와 검수 진입 가능 여부

## 14. 반응형과 접근성

- 일정·상태·대표 행동 순서를 모바일에서도 유지
- 카운트다운을 과도한 live region으로 알리지 않음
- 장치 오류와 해결 행동을 해당 점검 항목 가까이에 표시
- 상태를 색상만으로 구분하지 않음
- 시작·취소 확인 대화상자의 포커스 관리
- 점검 결과 갱신 시 사용자의 현재 포커스를 강제로 이동하지 않음

## 15. 미확정 사항

1. 기본 입장 가능 창과 허용 범위
2. 예상 진행 시간 입력 방식
3. `OPEN`을 저장 상태와 계산 상태 중 어느 방식으로 제공할지
4. 중복 접속 허용 여부와 이전 연결 종료 정책
5. `FAILED` 세션의 재시도와 새 세션 생성 정책

## 16. 이후 기능 후보

- lesson당 live session 1:N
- 공동 강사와 대체 강사
- 일정 반복·복제
- 푸시·이메일·캘린더 알림
- 출석 인정 정책

후보 기능은 채택되기 전까지 필수 컴포넌트나 API로 간주하지 않는다.
