# 구현 로드맵 — 명세대로 진행 가능(🟢) vs 더 고민 필요(🟡)

> ⚠️ **대체됨 (SUPERSEDED)**: 이 문서는 구 그룹 화상회의 명세 기준이다. 프로젝트는 **LiveClass AI**로 재설계됨 → **[architecture.md](architecture.md)** · [decisions/0003](decisions/0003-greenfield-redesign.md). 아래는 참고용(히스토리).

> 기준: [SPEC.md](./SPEC.md) (Sub Ⅰ/Ⅱ/Ⅲ 명세 추출본) + 현재 코드 상태.
> 🟢 = 명세에 규격(경로·요청·응답·규칙)이 있어 표준 패턴으로 바로 구현 가능.
> 🟡 = 설계 결정·인프라·정합성 이슈로 착수 전 합의/설계 필요.

---

## Sub Ⅰ — 인증 / 회원 + 데이터 모델

### 🟢 명세대로 진행 가능
| 영역 | 항목 | 현재 |
|------|------|------|
| BE | `GET /users/{userId}` 중복확인(409), `PATCH /users/{userId}`, `DELETE /users/{userId}`(방·이력 cascade) | ❌ 미구현 |
| BE | 회원가입 응답 **201**로 정정 | ⚠️ 현재 200 하드코딩 |
| BE | `/auth/login` 에러 규격(404 없음 / 401 비번틀림) | ⚠️ 확인·정정 |
| BE | 엔티티+Repository+RepositorySupport (conference_category / conference / user_conference / conference_history) | ❌ User만 존재 |
| BE | `data.sql` seed(user `test-1`, 카테고리 업무/교육/기타) + Swagger 어노테이션 | ❌ 없음 |
| FE | 토큰 localStorage 복원 + 진입 시 `/users/me` 로그인/비로그인 분기 | ❌ 없음 |
| FE | axios 인터셉터(401 세션무효/만료, 403), 로그아웃 | ❌ 헤더만 |
| FE | 회원가입 팝업(유효성), 로그인 팝업(명세 유효성), 중복확인 버튼, 로딩스피너 | ⚠️ 로그인 초안만 |

### 🟡 더 고민 필요
- **DELETE 탈퇴 cascade 범위**: 진행 중 방·참여자·이력 삭제 정책, 방장 위임 여부.
- **보안**: `jwt.secret`·DB 비번 평문 → 외부화.

---

## Sub Ⅱ — 방 CRUD + 미디어 인프라

### 🟢 명세대로 진행 가능
| 영역 | 항목 |
|------|------|
| BE API | `GET /conference-categories`, `POST /conferences`(201+conferenceId), `GET /conferences`, `GET /conferences/{id}`, `PATCH /conferences/{id}`(방장만) |
| BE | `Page/Pageable` 페이지네이션 + QueryDSL title 검색·sort·category 필터 |
| BE | STOMP 채팅 서버(`SimpleBroker`) + `ChannelInterceptor` 입장/퇴장 |
| FE | 공용 WebSocket 모듈(`connect/send/subscribe/unsubscribe/disconnect`) |
| FE | 생성/프로필 팝업, 방 목록(검색·정렬·무한스크롤 20개·반응형 그리드·상태태그·빈 상태) |

### 🟡 더 고민 필요
- **필드명 계약 통일** ⚠️ (최대 함정): 방 API가 응답 한 객체에서 snake(`conference_category`/`is_active`)와 camel(`joinUsersNum`/`callStartTime`) 혼용, 생성 Req `conferenceCategoryId`(camel) vs 수정 Req `conference_category`(snake). 착수 전 프론트/백 단일 규칙(권장 camelCase) 합의.
- **파일 업로드/서빙**: 썸네일 "방ID/파일명" 저장 + `/upload` 프록시 + 정적 매핑 설계.
- **Kurento 인프라**: Docker Kurento(8888) + **Coturn STUN/TURN은 로컬 불가 → Public/EC2 필요**, `WebRtcEndpoint.conf.ini` 주입.
- **HTTPS 전환**: keystore(p12)+`server.port=8443`+vite `https:true`. WebRTC 전제(현재 http).
- **두 WebSocket 채널 준비 + user_conference 동기화**.

---

## Sub Ⅲ — 그룹 화상 콜 + 채팅 + 배포

### 🟢 명세대로 진행 가능
| 영역 | 항목 |
|------|------|
| BE API | `GET /histories`(page, 본인 `conference_history`, `inserted_time` 최신순) |
| BE | `conference_history` 기록(action 0생성/1참여/2종료) |
| FE | 지난회의이력 테이블, 채팅 대화방 이벤트 UI(입장/퇴장/대화), 메시지 전송 |

### 🟡 더 고민 필요 (프로젝트의 진짜 난관)
- **WebRTC 시그널링 서버**(최고난도): raw WS `wss://.../webrtc` + `KurentoClient.createMediaPipeline` room·세션 관리 + `WebRtcPeerSendonly/Recvonly`. 인증·SDP/ICE·동시성 통합.
- **방 4명 제한 / 만석·비활성 진입 차단**.
- **방장 종료 트랜잭션**: 전원 exit + `is_active=false` + 파이프라인 release 원자성.
- **참여 상태 이중 동기화**: 채팅(ChannelInterceptor)과 시그널링(joinRoom/leaveRoom)이 둘 다 `user_conference` 갱신.
- **연결 정리**: `beforeunload`·새로고침·비정상 종료.
- **배포**: Docker Compose(mysql/kurento/app), EC2+FTP, TURN public IP.
- **심화**: 스티커(`FaceOverlayFilter`)·녹화 등 (선택).

---

## 권장 착수 순서
1. **필드명 계약 확정** (B: Sub Ⅱ)
2. Sub Ⅰ 인증·회원 마무리 (🟢)
3. Sub Ⅱ 방 CRUD·채팅 서버·방 목록 (🟢)
4. HTTPS·Kurento/Coturn 인프라 구축
5. Sub Ⅲ WebRTC 시그널링 서버 (최고난도)
6. 배포 + 심화

> 스케일아웃(Kurento/시그널링/채팅) 확장 계획은 [SCALEOUT_PLAN.md](./SCALEOUT_PLAN.md) 참고.
