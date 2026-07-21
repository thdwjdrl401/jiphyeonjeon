# LiveClass AI — 레슨 상세 컴포넌트

> 컴포넌트 원칙: [README.md](README.md) · 공통 레이아웃: [COMMON.md](COMMON.md) · 레슨 폼: [LESSON_FORM.md](LESSON_FORM.md) · 라이브 세션: [LIVE_SESSION.md](LIVE_SESSION.md) · VOD 레슨: [VOD_LESSON.md](VOD_LESSON.md) · 페이지 기준: [PAGES.md](../PAGES.md)

## 1. 목적

레슨 상세는 lesson의 기본 정보·게시 상태·PPTX 자료와 연결된 live session·다시보기 상태를 한곳에서 확인하는 허브 페이지다.

- 강사: lesson 준비·게시, 자료 상태, live session 생성·관리, 녹화·다시보기 관리로 이동
- 수강생: 게시된 lesson 정보와 자료를 확인하고 live session 상세 또는 게시된 다시보기로 이동

일정 편집, 사전 점검, 라이브 시작·종료는 live session 화면에서 처리한다. 라이브와 HLS 플레이어도 이 페이지에서 로드하지 않는다.

## 2. 확정 원칙

- lesson 상태는 `DRAFT → AI_NOT_READY → READY → PUBLISHED`
- 별도 `isPublished` boolean을 사용하지 않음
- 수강생은 `lessonStatus=PUBLISHED`인 레슨만 접근
- `AI_NOT_READY`에서는 live session 시작 불가
- live session은 별도 `sessionId`·상태·라우트 사용
- MVP에서는 lesson과 live session을 1:1로 제한
- lesson 상세는 live session 상태를 요약하고 전용 화면으로 연결
- HLS `READY`와 replay `PUBLISHED`를 분리
- 상태가 바뀌어도 자동으로 다른 페이지로 이동하지 않음

## 3. 컴포넌트 트리

```text
LessonDetailPage
└─ WorkspaceLayout
   ├─ LessonDetailHeader
   │  ├─ LessonBreadcrumbs
   │  ├─ LessonStatusBadge
   │  └─ LessonHeaderActions
   ├─ LessonOverview
   ├─ LessonReadinessSection               강사만
   │  ├─ LessonReadinessChecklist
   │  ├─ MaterialProcessingSummary
   │  └─ PublishLessonAction               READY 전용
   ├─ LessonMaterialSummary
   │  └─ LessonMaterialItem[]
   ├─ LinkedLiveSessionSection
   │  ├─ NoLiveSessionCard                 세션 없음
   │  └─ LiveSessionSummaryCard            세션 존재
   ├─ ReplayStatusSection                  종료 이후
   │  ├─ VideoAssetStatusSummary
   │  ├─ ReplayPublicationSummary
   │  └─ AiContentStatusSummary
   ├─ PreviousNextLessonNavigation
   └─ LessonDetailStatusRegion
```

## 4. 컴포넌트 책임

| 컴포넌트 | 소유 영역 | 책임 |
|---|---|---|
| `LessonDetailPage` | `pages` | 권한·lesson·자료·연결 세션·replay 상태 조회와 feature 조합 |
| `LessonDetailHeader` | page 전용 | 상위 경로, lesson 상태와 대표 행동 표시 |
| `LessonStatusBadge` | `features/lesson` | `DRAFT`·`AI_NOT_READY`·`READY`·`PUBLISHED` 표시 |
| `LessonHeaderActions` | page 조합 | 역할·상태별 수정·게시·세션·다시보기 이동 선택 |
| `LessonOverview` | `features/lesson` | 제목·설명·강사 정보 표시 |
| `LessonReadinessChecklist` | `features/lesson` | 필수 자료·AI·진행 중 작업과 게시 가능 여부 확인 |
| `PublishLessonAction` | `features/lesson` | `READY` lesson을 확인 후 `PUBLISHED`로 전환 |
| `LessonMaterialSummary` | `features/lesson-material` | 활성 PPTX와 처리 상태 표시 |
| `LinkedLiveSessionSection` | `features/live-session` | 연결 세션 존재 여부에 따라 생성 또는 상세 이동 조합 |
| `LiveSessionSummaryCard` | `features/live-session` | `sessionId`·일정·상태·입장 가능 여부 요약 |
| `ReplayStatusSection` | `features/replay` | 녹화 처리·replay 공개·AI 게시 상태 조합 |
| `VideoAssetStatusSummary` | `features/replay` | Egress 자산 처리 상태와 강사용 복구 동선 표시 |
| `ReplayPublicationSummary` | `features/replay` | `READY_FOR_REVIEW`·`PUBLISHED`·`WITHDRAWN` 표시 |

## 5. 접근 권한

### 5.1 해당 커리큘럼 강사

- lesson 상태와 관계없이 접근
- lesson 수정·자료 처리·게시 상태 확인
- `READY` lesson 게시
- 연결 live session 생성·수정·상세·처리 현황 이동
- 녹화 자산과 replay 미리보기·검수·게시 관리 이동

### 5.2 수강생

- `lessonStatus=PUBLISHED`인 레슨만 접근
- 활성 PPTX와 공개 가능한 lesson 정보 확인
- 연결 live session 상세에서 일정·입장 상태 확인
- `videoAssetStatus=READY`와 `replayStatus=PUBLISHED`를 모두 만족한 뒤 다시보기 이동
- 자신의 학습 진행 정보만 확인

### 5.3 그 외 사용자

- 상세 페이지 접근 차단
- 비로그인은 로그인 후 안전한 원래 목적지로 복귀
- 미수강 학생은 커리큘럼 상세와 수강 동선으로 이동
- 다른 강사는 소유권이 없으면 관리 정보에 접근할 수 없음

공개 목차의 lesson 제목 같은 제한 정보는 커리큘럼 상세에서 제공한다.

## 6. lesson 상태별 화면

| lesson 상태 | 강사 대표 행동 | 수강생 |
|---|---|---|
| `DRAFT` | 기본 정보·초기 자료 준비, 세션 초안 생성 가능 | 접근 불가 |
| `AI_NOT_READY` | 처리 상태 확인·실패 재시도, 세션 일정 관리 | 접근 불가 |
| `READY` | 최종 확인·lesson 게시, 세션 일정 관리 | 접근 불가 |
| `PUBLISHED` | live session 생성·관리 | lesson·자료 확인 |

### 6.1 게시

- 필수 PPTX가 하나 이상 존재
- 필수 자료의 파싱·chunk·embedding 완료
- 필수 AI 준비 실패 없음
- 진행 중인 자료 추가·삭제 작업 없음
- 강사가 명시적으로 게시 실행
- 성공 시 서버 결과로 `PUBLISHED` 갱신

게시 요청이 실패하면 `READY`를 유지한다. 프론트는 상태를 낙관적으로 변경하지 않는다.

### 6.2 게시 후 자료 변경

- 변경 영향과 수강생 공개 중단을 사전 안내
- 자료 작업 시작 시 서버 결과로 `AI_NOT_READY` 전환
- 연결 live session 일정은 유지하되 시작 차단
- AI 처리가 끝나면 `READY`
- 강사가 변경 내용을 확인하고 다시 게시해야 `PUBLISHED`

## 7. PPTX 자료 표시

### 7.1 수강생

- 활성 자료만 표시
- 원본 파일명과 파일 크기
- 권한이 적용된 원본 PPTX 다운로드
- 준비되지 않았거나 실패한 자료의 내부 오류 비노출

### 7.2 강사

- 활성·처리 중 자료 요약
- 자료별 업로드·검증·파싱·embedding 상태
- 현재 단일 추가·삭제 작업과 실패 단계
- 자료 수정·재시도를 위해 레슨 수정으로 이동

자료 업로드·삭제는 [LESSON_FORM.md](LESSON_FORM.md)에서만 수행한다.

## 8. 연결된 live session

### 8.1 세션 없음

- 강사에게 `라이브 세션 만들기` 제공
- lesson 게시·AI 준비 전에도 예약은 가능하지만 시작 차단 조건을 함께 표시
- 수강생에게는 아직 일정이 없다는 안내 표시

### 8.2 세션 존재

- `sessionId`
- 예정 시각과 입장 가능 시각
- `DRAFT`·`SCHEDULED`·`OPEN`·`STARTING`·`LIVE`·`ENDING`·`ENDED`·`CANCELLED`·`FAILED`
- 역할별 허용 행동
- 강사: 일정 수정, 상세, 사전 점검, 라이브 운영, 처리 현황
- 수강생: 세션 상세, 필수 입장 전 점검, 점검 완료 후 라이브 입장

lesson 상세는 세션 시작·종료 요청을 직접 보내지 않는다.

## 9. 녹화와 다시보기 상태

| 상태 조합 | 강사 | 수강생 |
|---|---|---|
| 세션 `ENDING/ENDED` + 자산 `FINALIZING/VERIFYING` | 처리 현황 | 다시보기 준비 중 |
| 자산 `FAILED` | 실패 원인·운영 복구 동선 | 준비 실패 안내 |
| 자산 `READY` + replay `READY_FOR_REVIEW` | 미리보기·검수·게시 | 게시 대기 |
| 자산 `READY` + replay `PUBLISHED` | 재생·게시본 관리 | 다시보기 |
| 자산 `READY` + replay `WITHDRAWN` | 미리보기·재게시 검토 | 공개 중단 안내 |

AI 콘텐츠가 일부 준비 중이거나 실패해도 게시된 HLS 재생을 막지 않는다. 수강생에게는 강사가 게시한 AI 콘텐츠만 표시한다.

## 10. 상태 갱신

- 페이지 진입과 브라우저 포커스 복귀 시 최신 조회
- 자료·AI·녹화 처리 중에는 제한적인 polling 허용
- `sessionId`가 생성되거나 상태가 바뀌면 세션 요약 갱신
- 상태가 `LIVE` 또는 replay `PUBLISHED`가 되어도 자동 이동하지 않음
- 향후 계약이 생기면 WS 또는 SSE 갱신으로 교체 가능

## 11. 주요 사용자 행동

### 11.1 강사

- lesson 정보·자료·AI 상태 확인
- lesson 수정과 처리 실패 복구
- `READY` lesson 게시
- live session 생성·관리로 이동
- 진행 중 라이브 운영으로 이동
- 종료 세션 처리 현황·VOD 검수·replay 게시로 이동

### 11.2 수강생

- 게시된 lesson과 활성 자료 확인
- live session 일정·입장 상태 확인
- 라이브 세션 상세·입장 전 점검·강의실 이동
- 게시된 다시보기 이동
- 이전·다음 lesson 이동

## 12. 필요한 데이터와 연결

정확한 필드와 API는 [API_MAP.md](../API_MAP.md)에서 확정한다.

- curriculum·section·lesson 기본 정보
- `lessonStatus`와 역할별 허용 행동
- 활성 PPTX와 강사용 처리 상태
- 연결된 `liveSessionId`·일정·상태·입장 가능 여부
- 대표 `videoAssetStatus`와 처리 실패 사유
- `replayStatus`와 게시·회수 허용 여부
- 영역별 AI 후보·게시 상태 요약
- 수강생 학습 진행 요약

프론트는 lesson 상태와 session 상태를 합쳐 새로운 단일 상태를 만들지 않는다.

## 13. 반응형과 접근성

- 모바일에서도 lesson·자료·live session·replay 영역 순서 유지
- 상태를 색상만으로 구분하지 않음
- polling 결과를 과도한 live region 알림으로 제공하지 않음
- 게시·자료 변경·replay 회수 확인 대화상자의 포커스 관리
- 비활성 행동 가까이에 차단 이유 제공
- PPTX 다운로드 상태를 보조기기에 전달

## 14. 미확정 사항

1. lesson 게시 취소 또는 비공개 전환 정책
2. 게시 후 기본 정보 수정 시 재게시 필요 범위
3. 녹화 자산이 여러 개인 경우 대표 자산 선택 규칙
4. 종료된 lesson 자료 revision과 게시본 교체 정책

## 15. 이후 기능 후보

- lesson 게시 이력과 되돌리기
- 종료된 lesson 자료 revision
- live session 1:N 확장
- 일정 변경 알림과 캘린더 추가
- 자료 일괄 다운로드

후보 기능은 채택되기 전까지 필수 컴포넌트나 API로 간주하지 않는다.
