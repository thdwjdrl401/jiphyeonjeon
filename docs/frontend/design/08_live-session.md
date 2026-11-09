# 라이브 세션 — 생성·수정·상세·입장 전 점검·처리 현황

> 원본: [../components/LIVE_SESSION.md](../components/LIVE_SESSION.md) · 로드맵: [00_ROADMAP.md](00_ROADMAP.md)

라이브 세션은 레슨에 연결된 실제 일정·입장·진행·종료 인스턴스다(레슨과 별도 ID/상태). 라이브 강의실 자체는 [09_live-lesson.md](09_live-lesson.md)에서 다룬다.

| 화면 | 라우트 | 레이아웃 | 접근 |
|---|---|---|---|
| 세션 생성 | 라우트 없음(레슨 생성·수정 폼에서 일정 입력) | `WorkspaceLayout` | 해당 레슨 강사 |
| 세션 수정 | 라우트 없음(레슨 수정 폼에서 일정 수정) | `WorkspaceLayout` | 해당 세션 강사 |
| 세션 상세 | 라우트 없음. 학생은 `/student/curriculums/:curriculumId/lessons/:lessonId/live-upcoming`, 강사 `/instructor/live-sessions/:sessionId`는 `preflight`로 리다이렉트 | `WorkspaceLayout` | 해당 강사·수강생 |
| 수강생 입장 전 점검 | `/student/live-sessions/:sessionId/prejoin` | `WorkspaceLayout` | 입장 권한 있는 수강생 |
| 강사 사전 점검 | `/instructor/live-sessions/:sessionId/preflight` | `WorkspaceLayout` | 해당 세션 강사 |
| 녹화 처리 현황 | `/instructor/live-sessions/:sessionId/processing` | `WorkspaceLayout` | 해당 세션 강사 |

## 세션 상태 모델
```text
DRAFT → SCHEDULED → OPEN → STARTING → LIVE → ENDING → ENDED
   └──────────────→ CANCELLED
STARTING ─────────→ FAILED
```
| 상태 | 의미 |
|---|---|
| `DRAFT` | 일정 작성 중 |
| `SCHEDULED` | 일정 확정, 대기 |
| `OPEN` | 입장 가능 창 시작 |
| `STARTING` | 시작 처리 중 |
| `LIVE` | 진행 중 |
| `ENDING` | 종료 처리 중 |
| `ENDED` | 종료 확정, 녹화 처리 진행 |
| `CANCELLED` | 시작 전 취소 |
| `FAILED` | 시작 실패 |

---

## 1. 세션 생성·수정
### 화면 구성
```text
LiveSessionForm
├─ ScheduledAtField       — 예정 시작 시각(필수)
├─ ExpectedDurationField  — 예상 진행 시간(선택)
├─ EntryWindowField       — 입장 가능 창
├─ RecordingPolicyNotice  — 녹화 항상 진행됨을 알리는 고지(토글 아님)
└─ LiveSessionFormActions
```
레슨 제목·자료·AI 정책은 여기서 다루지 않는다. MVP는 레슨당 세션 1개 제한 — 기존 세션이 있으면 새로 만들지 않고 기존 세션으로 안내한다.

### 상태
`DRAFT`·`SCHEDULED`에서 자유롭게 수정, `OPEN` 이후 제한적 수정, `STARTING` 이후 수정·취소 차단. 저장 중 중복 제출 방지.

### 다음 화면
저장 완료 → 세션 상세

---

## 2. 세션 상세 (공통, 역할별 행동만 다름)
### 화면 구성
```text
LiveSessionHeader
LiveSessionScheduleCard   — 예정 시각·예상 시간·입장 가능 시각
LiveSessionStatusCard     — 서버 상태 + 차단 사유 + 다음 행동
RecordingNotice
LessonReadinessSummary    — 레슨 게시·자료·AI 준비 상태 요약
RoleBasedSessionActions
```

### 상태별 대표 행동
| 세션 상태 | 강사 | 수강생 |
|---|---|---|
| `DRAFT` | 일정 계속 작성 | 노출 안 함 |
| `SCHEDULED` | 수정·취소·사전 점검 | 일정·카운트다운 확인 |
| `OPEN` | 사전 점검·시작 | 입장 전 점검 |
| `STARTING` | 시작 결과 대기 | 강사 시작 대기 |
| `LIVE` | 라이브 운영(강의실 이동) | 입장 전 점검 또는 즉시 입장 |
| `ENDING` | 종료 결과 확인 | 종료 처리 안내 |
| `ENDED` | 녹화 처리 현황으로 이동 | 다시보기 준비 상태 안내 |
| `CANCELLED` | 취소 상태 확인 | 취소 안내 |
| `FAILED` | 실패 원인·복구 확인 | 진행 불가 안내 |

---

## 3. 수강생 입장 전 점검 (`/prejoin`)
```text
StudentPrejoinPanel
├─ SpeakerCheck
├─ AutoplayCheck        — 브라우저 자동재생 가능 여부
├─ NetworkCheck
├─ DisplayNameConfirm
├─ RecordingConsentNotice
└─ JoinClassroomAction
```
카메라·마이크 권한은 요청하지 않는다(수강생은 수신 전용). 점검을 통과해도 세션이 `LIVE`가 아니면 강의실 대신 "시작 대기" 상태를 보여준다.

## 4. 강사 사전 점검 (`/preflight`)
```text
InstructorPreflightPanel
├─ CameraPreview
├─ MicrophoneCheck
├─ NetworkCheck
├─ LessonAiReadinessCheck
├─ LiveKitReadinessCheck
├─ EgressReadinessCheck
├─ SttReadinessCheck
└─ StartLiveSessionAction
```
### 시작 차단 조건 (경고만 표시, 우회 불가)
레슨 미게시 · 필수 PPTX 없음 · AI 준비 미완료/실패 · 자료 작업 진행 중 · 세션이 `SCHEDULED`/`OPEN` 아님 · 강사 소유권 없음 · 카메라/마이크 미준비 · LiveKit/Egress/STT 준비 불가

시작 성공 시 강의실(`/classroom`)로 이동한다.

---

## 5. 녹화 처리 현황 (`/processing`)
### 화면 구성
```text
SessionEndSummary
VideoAssetProcessingSteps   — FINALIZING → VERIFYING → READY (또는 FAILED)
ProcessingRecoveryActions
ReplayAutoEntry             — READY + PUBLISHED 시 강사 VOD 화면으로 자동 이동
```
종료 성공 직후 한 번 조회하고, 진행 상태는 최초 30초 2초 간격·이후 5초 간격으로 DB snapshot을
폴링한다. `READY + PUBLISHED`에서 폴링을 멈추고 강사 VOD 화면으로 `replace` 이동한다. `FAILED`에서는
폴링을 멈추고 실패 사유와 복귀 동선을 표시하며 재업로드 버튼은 제공하지 않는다. AI 후처리는 영상
자동 게시의 완료 조건이 아니며 이 화면의 polling 응답에 합치지 않는다.

---

## 공통 상태
- 인증·권한 확인 중에는 역할별 행동을 먼저 노출하지 않음
- `STARTING`·`ENDING`은 timeout을 임의로 성공/실패로 확정하지 않고 진행 중 표시 유지
- 5xx/네트워크 장애와 권한·상태 충돌을 구분해 표시

## 다음 화면
세션 상세 "사전 점검" → 강사 사전 점검 · "입장 전 점검" → 수강생 prejoin · 시작 성공 → 09_live-lesson(강의실) · 강사 종료 성공 → 녹화 처리 현황 · 처리 현황 `READY + PUBLISHED` → 10_vod-lesson 자동 이동
