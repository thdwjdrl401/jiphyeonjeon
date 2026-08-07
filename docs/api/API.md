# LiveClass AI API · 엔드포인트 목록

> 📍 계약의 **정본은 [../CONTRACT.md](../CONTRACT.md)** 다. 이 파일은 **실제로 떠 있는 서버의 OpenAPI 스펙에서 생성**한 목록이라, 둘이 어긋나면 계약이 지켜지지 않았다는 뜻이다.

- 출처: openapi.json 스냅샷 — 운영 백엔드(master b49bfd68) 2026-08-07 채취
- OpenAPI 3.1.0 · 엔드포인트 130개 · 모델 142개
- 파라미터·본문·응답 스키마까지 보려면 배포본 `/api-docs/` (원본 `frontend/public/api-docs/index.html`)

## 접근 권한 요약

`SecurityConfig.java` 의 체인을 경로별로 풀어 본 것이다. Swagger는 이걸 못 보여준다.

| 배지 | 뜻 | 개수 |
|---|---|---|
| **공개** | 인증 없이 호출된다 | 7 |
| **서명** | 로그인 세션이 아니라 서명·토큰으로 인증한다(서버 간) | 10 |
| **로그인** | 세션 쿠키 필요 | 54 |
| **STUDENT** | 학생 역할 필요 | 4 |
| **INSTRUCTOR** | 강사 역할 필요 | 47 |
| **ADMIN** | 관리자 역할 필요 | 8 |

## 레슨 AI 질의응답

게시된 강의의 자막·PPTX를 근거로 답변을 SSE로 중계한다.

| 메서드 | 경로 | 하는 일 | 권한 |
|---|---|---|---|
| `POST` | `/api/lessons/{lessonId}/ai/answers/stream` | 레슨 AI 질문(SSE) | 로그인 |

## 인증

회원가입·로그인·로그아웃. 로그인하면 서버가 HttpOnly 쿠키에 세션을 담아주고, 이후 요청은 그 쿠키로 인증된다(토큰을 직접 들고 다니지 않음).

| 메서드 | 경로 | 하는 일 | 권한 |
|---|---|---|---|
| `GET` | `/api/auth/csrf` | CSRF 토큰 발급 | 공개 |
| `GET` | `/api/auth/email-availability` | 이메일 사용 가능 여부 | 공개 |
| `POST` | `/api/auth/login` | 로그인 | 공개 |
| `POST` | `/api/auth/logout` | 로그아웃 | 공개 |
| `GET` | `/api/auth/me` | 현재 사용자 조회 | 로그인 |
| `POST` | `/api/auth/signup` | 회원가입 | 공개 |

## 라이브 판서

판서 op 적재·복원(REST). 실시간 전달은 LiveKit 데이터 채널로 별개.

| 메서드 | 경로 | 하는 일 | 권한 |
|---|---|---|---|
| `GET` | `/api/live-sessions/{sessionId}/annotation` | 판서 문서 복원 | 서명 |
| `GET` | `/api/live-sessions/{sessionId}/annotation/highlights` | 강조 판서 캡처 목록 | 로그인 |
| `POST` | `/api/live-sessions/{sessionId}/annotation/highlights` | 강조 판서 캡처 저장 | 로그인 |
| `DELETE` | `/api/live-sessions/{sessionId}/annotation/highlights/{highlightId}` | 강조 판서 캡처 제외 | 로그인 |
| `POST` | `/api/live-sessions/{sessionId}/annotation/interpret` | 판서 해석 | 로그인 |
| `POST` | `/api/live-sessions/{sessionId}/annotation/ops` | 판서 op 적재 | 로그인 |
| `PUT` | `/api/live-sessions/{sessionId}/annotation/snapshot` | 판서 복원 체크포인트 저장 | 로그인 |
| `PUT` | `/api/live-sessions/{sessionId}/annotation/visibility` | 판서 표시 상태 변경 | 로그인 |

## 운영 콘솔

운영자가 화면에서 판단하는 데 필요한 조합 조회.

| 메서드 | 경로 | 하는 일 | 권한 |
|---|---|---|---|
| `GET` | `/api/admin/live-sessions/{sessionId}` | 세션 운영 상세 | ADMIN |
| `POST` | `/api/admin/session-labels` | 세션 이름표 일괄 조회 | ADMIN |

## 웹 푸시

브라우저 푸시 구독 등록·해제. 탭을 닫아도 알림이 온다.

| 메서드 | 경로 | 하는 일 | 권한 |
|---|---|---|---|
| `DELETE` | `/api/me/push-subscriptions` | 구독 해제 | 로그인 |
| `POST` | `/api/me/push-subscriptions` | 구독 등록 | 로그인 |
| `GET` | `/api/me/push-subscriptions/public-key` | VAPID 공개키 | 로그인 |
| `POST` | `/api/me/push-subscriptions/status` | 이 구독이 내 것으로 등록돼 있는지 | 로그인 |

## 녹화강의 관리(강사)

MP4 원본을 직접 업로드하고 HLS 변환 상태를 관리한다.

| 메서드 | 경로 | 하는 일 | 권한 |
|---|---|---|---|
| `POST` | `/api/instructor/recorded-lessons/{lessonId}/captions/retry` | 실패했거나 비어 있는 녹화강의 자막 재생성 | INSTRUCTOR |
| `GET` | `/api/instructor/recorded-lessons/{lessonId}/processing` | 녹화강의 영상 처리 상태 조회 | INSTRUCTOR |
| `POST` | `/api/instructor/recorded-lessons/{lessonId}/processing/retry` | 실패한 녹화강의 영상 변환 재시도 | INSTRUCTOR |
| `POST` | `/api/instructor/recorded-lessons/{lessonId}/video/complete` | 녹화강의 MP4 업로드 완료 및 변환 접수 | INSTRUCTOR |
| `POST` | `/api/instructor/recorded-lessons/{lessonId}/video/upload-requests` | 녹화강의 MP4 업로드 URL 발급 | INSTRUCTOR |
| `POST` | `/api/instructor/sections/{sectionId}/recorded-lessons` | 녹화강의 생성 | INSTRUCTOR |

## 녹화강의 재생

업로드 녹화강의의 HLS 재생 정보와 manifest를 제공한다.

| 메서드 | 경로 | 하는 일 | 권한 |
|---|---|---|---|
| `GET` | `/api/lessons/{lessonId}/recorded-playback` | 녹화강의 재생 정보 | 로그인 |
| `GET` | `/api/lessons/{lessonId}/recorded-playback/captions` | 게시된 녹화강의 구조화 자막 | 로그인 |
| `GET` | `/api/lessons/{lessonId}/recorded-playback/captions/{trackId}.vtt` | 게시된 녹화강의 WebVTT 자막 | 로그인 |
| `GET` | `/api/lessons/{lessonId}/recorded-playback/manifest` | 녹화강의 HLS 재생목록 | 로그인 |

## 에셋 업로드

presigned URL로 스토리지에 직접 올린다. 백엔드는 URL 발급과 완료 확인만 한다.

| 메서드 | 경로 | 하는 일 | 권한 |
|---|---|---|---|
| `POST` | `/api/assets/upload-requests` | 업로드 요청 | 로그인 |
| `POST` | `/api/assets/{assetId}/complete` | 업로드 완료 통지 | 로그인 |

## 수강

학생 수강 신청·취소

| 메서드 | 경로 | 하는 일 | 권한 |
|---|---|---|---|
| `POST` | `/api/curriculums/{curriculumId}/enrollments` | 수강 신청 | STUDENT |
| `DELETE` | `/api/curriculums/{curriculumId}/enrollments/me` | 수강 신청/수강 취소 | STUDENT |
| `GET` | `/api/me/enrollments` | 내 수강 목록 | 로그인 |

## 학습

학생 학습 요약(대시보드)

| 메서드 | 경로 | 하는 일 | 권한 |
|---|---|---|---|
| `GET` | `/api/me/learning-summary` | 내 학습 요약 | 로그인 |

## 수강(강사)

수강생 로스터·승인·거절·제적

| 메서드 | 경로 | 하는 일 | 권한 |
|---|---|---|---|
| `GET` | `/api/instructor/curriculums/{curriculumId}/enrollments` | 수강생 로스터 | INSTRUCTOR |
| `POST` | `/api/instructor/curriculums/{curriculumId}/enrollments/{enrollmentId}/approve` | 수강 승인 | INSTRUCTOR |
| `POST` | `/api/instructor/curriculums/{curriculumId}/enrollments/{enrollmentId}/reject` | 수강 거절 | INSTRUCTOR |
| `POST` | `/api/instructor/curriculums/{curriculumId}/enrollments/{enrollmentId}/revoke` | 수강 제적(강퇴) | INSTRUCTOR |

## 레슨(수강생)

수강 중인 커리큘럼의 레슨 상세를 연다.

| 메서드 | 경로 | 하는 일 | 권한 |
|---|---|---|---|
| `GET` | `/api/lessons/{lessonId}` | 레슨 상세 | 로그인 |
| `GET` | `/api/lessons/{lessonId}/materials/{materialId}/download` | 레슨 자료 다운로드(수강생) | STUDENT |

## 알림

내 알림 목록·배지·읽음 처리. 본인 것만 보인다.

| 메서드 | 경로 | 하는 일 | 권한 |
|---|---|---|---|
| `GET` | `/api/me/notifications` | 내 알림 목록 | 로그인 |
| `POST` | `/api/me/notifications/read-all` | 모두 읽음 | 로그인 |
| `GET` | `/api/me/notifications/summary` | 배지 개수 | 로그인 |
| `POST` | `/api/me/notifications/{notificationId}/read` | 개별 읽음 | 로그인 |
| `GET` | `/api/me/notifications/{notificationId}/target` | 클릭 대상 재판정 | 로그인 |

## 알림 설정

라이브 곧 시작 알림의 리드타임. 커리큘럼 단위이고 강의별로 덮어쓴다.

| 메서드 | 경로 | 하는 일 | 권한 |
|---|---|---|---|
| `GET` | `/api/me/notification-preferences` | 지금 적용되는 설정 | 로그인 |
| `PUT` | `/api/me/notification-preferences` | 설정 저장 | 로그인 |
| `GET` | `/api/me/notification-preferences/lead-times` | 고를 수 있는 리드타임 | 로그인 |

## 다시보기

라이브 되감기·종료 후 VOD 재생(metadata + presigned 재작성 manifest)과 게시·철회.

| 메서드 | 경로 | 하는 일 | 권한 |
|---|---|---|---|
| `POST` | `/api/instructor/lessons/{lessonId}/replay-review/publish` | 다시보기 게시 | INSTRUCTOR |
| `POST` | `/api/instructor/lessons/{lessonId}/replay-review/withdraw` | 다시보기 게시 철회 | INSTRUCTOR |
| `GET` | `/api/lessons/{lessonId}/playback` | 다시보기 재생 정보 | 로그인 |
| `GET` | `/api/lessons/{lessonId}/playback/manifest` | HLS 재생목록 | 로그인 |

## 학습 상태

레슨 진도를 다룬다. 수강자만.

| 메서드 | 경로 | 하는 일 | 권한 |
|---|---|---|---|
| `PUT` | `/api/instructor/lessons/{lessonId}/glossary` | 용어 수정·추가(강사) | INSTRUCTOR |
| `GET` | `/api/lessons/{lessonId}/glossary` | 강의 용어집 조회 | 로그인 |
| `GET` | `/api/lessons/{lessonId}/learning-context` | 학습 컨텍스트 조회 | 로그인 |
| `PUT` | `/api/lessons/{lessonId}/progress` | 진도 갱신 | 로그인 |
| `PUT` | `/api/lessons/{lessonId}/watch-buckets` | 구간별 시청 횟수 보고 | 로그인 |
| `GET` | `/api/lessons/{lessonId}/watch-buckets/me` | 내 구간별 시청 횟수 | 로그인 |
| `GET` | `/api/lessons/{lessonId}/watch-heatmap` | 많이 다시 본 구간 그래프 | 로그인 |

## AI Material URL

AI 워커가 자료 파일을 읽을 presigned URL을 주문형으로 발급한다.

| 메서드 | 경로 | 하는 일 | 권한 |
|---|---|---|---|
| `POST` | `/api/internal/ai/materials/download-url` | 자료 다운로드 URL 발급 | 서명 |

## 내 계정

로그인한 사용자가 자기 계정을 관리한다.

| 메서드 | 경로 | 하는 일 | 권한 |
|---|---|---|---|
| `DELETE` | `/api/me` | 회원 탈퇴 | 로그인 |
| `PUT` | `/api/me/display-name` | 표시 이름 변경 | 로그인 |
| `GET` | `/api/me/instructor-profile` | 강사 공개 프로필 조회 | 로그인 |
| `PUT` | `/api/me/instructor-profile` | 강사 공개 프로필 저장 | 로그인 |
| `PUT` | `/api/me/password` | 비밀번호 변경 | 로그인 |
| `PUT` | `/api/me/profile-image` | 프로필 이미지 설정 | 로그인 |

## 라이브 자막

자막 리로드(REST, 세션 기준). 실시간 전달은 WebSocket으로 별도.

| 메서드 | 경로 | 하는 일 | 권한 |
|---|---|---|---|
| `GET` | `/api/live-sessions/{sessionId}/captions` | 자막 리로드 조회 | 로그인 |

## AI Callback

AI 워커의 처리 완료/실패 콜백을 받아 상태를 확정한다.

| 메서드 | 경로 | 하는 일 | 권한 |
|---|---|---|---|
| `POST` | `/api/internal/ai/callbacks` | AI 콜백 | 서명 |

## 커리큘럼 관리(강사)

강사가 자기 커리큘럼과 그 안의 섹션(목차)을 만들고 수정한다. 본인 것만 접근할 수 있다.

| 메서드 | 경로 | 하는 일 | 권한 |
|---|---|---|---|
| `GET` | `/api/instructor/curriculums` | 내 커리큘럼 목록 | INSTRUCTOR |
| `POST` | `/api/instructor/curriculums` | 커리큘럼 생성 | INSTRUCTOR |
| `DELETE` | `/api/instructor/curriculums/{curriculumId}` | 커리큘럼 삭제 | INSTRUCTOR |
| `GET` | `/api/instructor/curriculums/{curriculumId}` | 커리큘럼 관리 조회 | INSTRUCTOR |
| `PATCH` | `/api/instructor/curriculums/{curriculumId}` | 커리큘럼 기본 정보 수정 | INSTRUCTOR |
| `POST` | `/api/instructor/curriculums/{curriculumId}/archive` | 커리큘럼 보관 | INSTRUCTOR |
| `PUT` | `/api/instructor/curriculums/{curriculumId}/curriculum/order` | 구조 순서 저장 | INSTRUCTOR |
| `POST` | `/api/instructor/curriculums/{curriculumId}/materials` | 커리큘럼 자료 연결 | INSTRUCTOR |
| `DELETE` | `/api/instructor/curriculums/{curriculumId}/materials/{materialId}` | 커리큘럼 자료 삭제 | INSTRUCTOR |
| `GET` | `/api/instructor/curriculums/{curriculumId}/materials/{materialId}/download` | 커리큘럼 자료 다운로드 | INSTRUCTOR |
| `POST` | `/api/instructor/curriculums/{curriculumId}/publish` | 커리큘럼 발행 | INSTRUCTOR |
| `GET` | `/api/instructor/curriculums/{curriculumId}/sections` | 섹션 목록 | INSTRUCTOR |
| `POST` | `/api/instructor/curriculums/{curriculumId}/sections` | 섹션 생성 | INSTRUCTOR |
| `DELETE` | `/api/instructor/curriculums/{curriculumId}/thumbnail` | 커리큘럼 대표 이미지 삭제 | INSTRUCTOR |
| `DELETE` | `/api/instructor/sections/{sectionId}` | 섹션 삭제 | INSTRUCTOR |
| `PATCH` | `/api/instructor/sections/{sectionId}` | 섹션 수정 | INSTRUCTOR |

## 강사 대시보드

강사 운영 요약(대시보드)

| 메서드 | 경로 | 하는 일 | 권한 |
|---|---|---|---|
| `GET` | `/api/instructor/dashboard-summary` | 강사 대시보드 요약 | INSTRUCTOR |

## 카탈로그(공개)

누구나(로그인 없이) 공개된 커리큘럼을 검색하고 열어볼 수 있는 조회 API.

| 메서드 | 경로 | 하는 일 | 권한 |
|---|---|---|---|
| `GET` | `/api/curriculums` | 공개 커리큘럼 목록 | 공개 |
| `GET` | `/api/curriculums/{curriculumId}` | 공개 커리큘럼 상세 | 공개 |
| `GET` | `/api/curriculums/{curriculumId}/materials/{materialId}/download` | 커리큘럼 자료 다운로드(수강생) | STUDENT |

## 라이브 채팅

채팅 저장·복구(REST, 세션 기준). 실시간 전달은 WebSocket으로 별도.

| 메서드 | 경로 | 하는 일 | 권한 |
|---|---|---|---|
| `GET` | `/api/live-sessions/{sessionId}/messages` | 채팅 복구 조회 | 로그인 |
| `POST` | `/api/live-sessions/{sessionId}/messages` | 채팅 전송 | 로그인 |

## 레슨 관리(강사)

강사가 섹션 안의 레슨을 만들고 수정한다. 본인 커리큘럼의 레슨만 접근할 수 있다.

| 메서드 | 경로 | 하는 일 | 권한 |
|---|---|---|---|
| `DELETE` | `/api/instructor/lessons/{lessonId}` | 레슨 삭제 | INSTRUCTOR |
| `GET` | `/api/instructor/lessons/{lessonId}` | 레슨 조회 | INSTRUCTOR |
| `PATCH` | `/api/instructor/lessons/{lessonId}` | 레슨 수정 | INSTRUCTOR |
| `POST` | `/api/instructor/lessons/{lessonId}/materials` | 레슨 자료 연결 | INSTRUCTOR |
| `DELETE` | `/api/instructor/lessons/{lessonId}/materials/{materialId}` | 레슨 자료 삭제 | INSTRUCTOR |
| `GET` | `/api/instructor/lessons/{lessonId}/materials/{materialId}/download` | 레슨 자료 다운로드 | INSTRUCTOR |
| `GET` | `/api/instructor/sections/{sectionId}/lessons` | 레슨 목록 | INSTRUCTOR |
| `POST` | `/api/instructor/sections/{sectionId}/lessons` | 레슨 생성 | INSTRUCTOR |

## 라이브 세션

라이브 세션 생성(강사)·조회·토큰·시작/종료.

| 메서드 | 경로 | 하는 일 | 권한 |
|---|---|---|---|
| `POST` | `/api/instructor/lessons/{lessonId}/live-sessions` | 라이브 세션 생성 | INSTRUCTOR |
| `PATCH` | `/api/instructor/live-sessions/{sessionId}` | 라이브 세션 일정 수정 | INSTRUCTOR |
| `POST` | `/api/instructor/live-sessions/{sessionId}/cancel` | 라이브 세션 취소 | INSTRUCTOR |
| `GET` | `/api/instructor/live-sessions/{sessionId}/participants` | 방 참여자 목록 | INSTRUCTOR |
| `DELETE` | `/api/instructor/live-sessions/{sessionId}/participants/{identity}` | 참여자 강퇴 | INSTRUCTOR |
| `POST` | `/api/instructor/live-sessions/{sessionId}/preflight` | preflight 방 준비 | INSTRUCTOR |
| `GET` | `/api/instructor/live-sessions/{sessionId}/preflight/readiness` | preflight readiness 검사 | INSTRUCTOR |
| `GET` | `/api/instructor/live-sessions/{sessionId}/processing` | 종료 후 처리 현황 조회 | INSTRUCTOR |
| `POST` | `/api/instructor/live-sessions/{sessionId}/token` | 강사 LiveKit 토큰 발급 | INSTRUCTOR |
| `GET` | `/api/live-sessions/{sessionId}` | 라이브 세션 조회 | 로그인 |
| `POST` | `/api/live-sessions/{sessionId}/end` | 라이브 종료 | 로그인 |
| `GET` | `/api/live-sessions/{sessionId}/notes` | 라이브 강의 노트 조회 | 로그인 |
| `POST` | `/api/live-sessions/{sessionId}/start` | 라이브 시작 요청 | 로그인 |
| `GET` | `/api/live-sessions/{sessionId}/start-status` | 라이브 시작 상태 조회 | 로그인 |

## LiveKit Webhook

egress 완료 신호를 받아 녹화 자산을 확정한다.

| 메서드 | 경로 | 하는 일 | 권한 |
|---|---|---|---|
| `POST` | `/api/webhooks/livekit` | LiveKit egress webhook | 서명 |

## 라이브 AI 질의응답

세션 문맥 RAG 답변을 SSE로 중계한다.

| 메서드 | 경로 | 하는 일 | 권한 |
|---|---|---|---|
| `GET` | `/api/live-sessions/{sessionId}/ai/answers` | 내 AI 질문 기록 조회 | 로그인 |
| `POST` | `/api/live-sessions/{sessionId}/ai/answers/stream` | 라이브 AI 질문(SSE) | 로그인 |

## egress-admin-controller

| 메서드 | 경로 | 하는 일 | 권한 |
|---|---|---|---|
| `GET` | `/api/admin/egress` |  | ADMIN |
| `POST` | `/api/admin/egress/{egressId}/purge` |  | ADMIN |
| `POST` | `/api/admin/egress/{egressId}/stop` |  | ADMIN |

## live-admin-controller

| 메서드 | 경로 | 하는 일 | 권한 |
|---|---|---|---|
| `GET` | `/api/admin/live/summary` |  | ADMIN |

## media-transcode-internal-controller

| 메서드 | 경로 | 하는 일 | 권한 |
|---|---|---|---|
| `POST` | `/api/internal/media/transcode-callbacks` |  | 서명 |
| `POST` | `/api/internal/media/transcode-jobs/{jobId}/source-url` |  | 서명 |

## recorded-stt-internal-controller

| 메서드 | 경로 | 하는 일 | 권한 |
|---|---|---|---|
| `POST` | `/api/internal/ai/recorded-stt-callbacks` |  | 서명 |
| `PUT` | `/api/internal/ai/recorded-stt-jobs/{jobId}/chunks/{chunkIndex}` |  | 서명 |
| `GET` | `/api/internal/ai/recorded-stt-jobs/{jobId}/progress` |  | 서명 |
| `POST` | `/api/internal/ai/recorded-stt-jobs/{jobId}/source-url` |  | 서명 |

## recording-admin-controller

| 메서드 | 경로 | 하는 일 | 권한 |
|---|---|---|---|
| `POST` | `/api/admin/recordings/reconcile` |  | ADMIN |
| `GET` | `/api/admin/recordings/summary` |  | ADMIN |

## 다시 만들기

```bash
# 운영 백엔드에서 스펙을 뜬다 (밖에서는 /v3/api-docs 가 SPA로 떨어진다)
ssh ec2 'docker exec liveclass-backend-prod wget -qO- http://localhost:8080/v3/api-docs' > docs/api/openapi.json
python3 docs/api/tools/build_api_reference.py
```

`SecurityConfig.java` 의 권한 체인을 고치면 `build_api_reference.py` 의 `AUTH_RULES` 도 같이 고친다 — 여기 배지는 그 표에서 계산한 값이다.
