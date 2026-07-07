# 그룹 비디오 컨퍼런스 서비스 — 명세서 추출본 (SPEC)

> 원본: `docs/Sub_PJT_1_명세서.pdf`, `Sub_PJT_2_명세서.pdf`, `Sub_PJT_3_명세서.pdf` (모두 이미지 기반 PDF, 텍스트 레이어 없음 → OCR/전사).
> OCR 추출 과정의 명백한 오타·오탈자는 교정함 (`department`, `bcrypt`, `accessToken`, `existingParticipants` 등).
> 단, API 응답 JSON의 snake/camel 필드 표기 혼용은 OCR이 아니라 **명세 자체의 실제 계약 불일치**이므로 필드명은 그대로 두고 별도 표기함(구현 시 통일 필요).
> 순수 설치 스크린샷·와이어프레임 묘사는 요지만 축약. 요구사항·API·ERD·소켓 규격·설정값·예제코드는 원문 유지.

---

# Sub PJT Ⅰ — 인증 / 회원 + 데이터 모델

## 1. 개요
- **WebRTC**를 활용한 그룹 화상 회의 기능을 갖춘 "그룹 비디오 컨퍼런스 서비스" 개발.
- Front-end: **Vue 3** 기반 반응형 **SPA**.
- Back-end: **Java + Spring Boot**, **WebSocket, WebRTC** 프로토콜, **REST API**.
- WebRTC를 위해 **Media Server(Kurento)** 설치를 권장(별도 스트리밍 서버).
- DB: **MySQL 8.0.x** (DB명 `liveclass_web_db`, `utf8mb4_general_ci`), JDK **11** LTS, 커넥션풀 **HikariCP**.

### 단계별 일정
| 단계 | 기간 | 세부 |
|------|------|------|
| Sub Ⅰ | Week 1 | 개발환경 설정, 디렉토리 구조, 주요 개념, **회원가입/로그인 구현** |
| Sub Ⅱ | Week 2-3 | 방 **CRUD API**, 목록 조회/검색/정렬, 방 상세, 방 편집, **WebRTC 미디어 서버 설정**, Dockerizing/배포 |
| Sub Ⅲ | Week 4-6 | **그룹 화상 컨퍼런스 콜**, **그룹 채팅**, 심화 기능 |

## 2. 데이터 모델 (ERD) — Information Engineering Style

**conference_category [컨퍼런스 종류]**
- id : Integer (PK)
- name : String

**user [사용자]**
- id : Integer (PK)
- department : String
- position : String
- name : String
- user_id : String
- password : String

**user_conference**
- id : Integer (PK)
- conference_id : Integer
- user_id : Integer

**conference [컨퍼런스]**
- id : Integer (PK)
- owner_id : Integer
- conference_category : Integer
- call_start_time : DateTime
- call_end_time : DateTime
- thumbnail_url : String
- title : String
- description : String
- is_active : Boolean

**conference_history [컨퍼런스 이력]**
- id : Integer (PK)
- conference_id : Integer
- user_id : Integer
- action : SmallInteger (CREATE, JOIN, EXIT)
- inserted_time : DateTime

**관계/설명**
- user ↔ user_conference ↔ conference (N:N 매핑). conference_category ↔ conference. user/conference ↔ conference_history.
- **user_conference**: user와 conference를 N:N 매핑하여 현재 동작 중인 방 정보를 저장. 목록 조회 시 현재 참여중인 유저 수·방장 정보를 매핑해 함께 응답해야 함. user가 conference를 생성/참여/나갈 때 **WebRTC(화상)와 SocketIO(채팅)** 채널 참여 정보와 동기화. **Kurento-WebRTC 및 SocketIO 채팅 동기화용 컬럼이 필요에 따라 추가될 수 있음.**
- **conference_history**: user가 conference를 생성/참여/나갈 때 이력관리용으로 Insert.

## 3. Database 초기 스크립트 (INIT.SQL)
초기 SQL로 아래 데이터가 Insert되게 한다.
- **user 테이블**: id=1, department=부트캠프, name=홍길동, password=`$2a$10$0sN1Ks6TUMs4hTLydDpC4.LWFpzb4dY20ZYNEegPKHkeEMqvyk85S` (`12345`를 bcrypt 암호화), position=교육생, user_id=test-1
- **conference_category 테이블**: (1, 업무), (2, 교육), (3, 기타)

## 4. JPA / API 공통 규격
- **JPA**: 각 테이블의 Entity 구현, 테이블별 Repository와 RepositorySupport 구현.
- **API Version Prefix**: `/api/v1`.
- **API Model**: 요청/응답용 Request Model, Response Model 제공.
- **Service & Impl**: API별 Service 구현(DB 접근·트랜잭션·데이터 가공).
- **Controller**: API별 Controller 구현, 카테고리별 파일 분리.
- **Swagger**: SwaggerUI `http://localhost:8080/swagger-ui/`, 각 엔드포인트에 Swagger 어노테이션.

## 5. API 명세

### 인증
**[POST] /auth/login** — ID/Password로 인증 및 **JWT 토큰** 발급
- 에러: 회원 없음 → **404** "존재하지 않는 계정입니다." / 비밀번호 불일치 → **401** "잘못된 비밀번호입니다."

### 유저
**[POST] /users** — 회원가입 (권한: 모두)
- Request Body: `{ "department":"String", "position":"String", "name":"String", "user_id":"String", "password":"String" }`
- Response 201: `{ "message":"Success" }`

**[GET] /users/me** — 내 프로필 (권한: 로그인 사용자)
- Response 200: `{ "department":"String", "position":"String", "name":"String", "user_id":"String" }`

**[GET] /users/<string:userId>** — 존재하는 회원 확인(중복확인) (권한: 모두)
- 로그인 사용자가 아닌 경우에만 응답. **409**: `{ "message":"이미 존재하는 사용자 ID 입니다." }`

**[PATCH] /users/<string:userId>** — 정보 수정 (권한: 로그인 사용자)
- Request Body: `{ "department":"String", "position":"String", "name":"String" }`
- Response 200: `{ "message":"Success" }`

**[DELETE] /users/<string:userId>** — 탈퇴 (권한: 로그인 사용자)
- Response 204: `{ "message":"Success" }`
- 기능: 해당 유저가 생성한 방 모두 삭제 + 지난 회의 이력 모두 삭제 + 유저 정보 삭제.

## 6. Front-end 요구사항 (Sub Ⅰ)

### 공통 — 인증/토큰 관리
- 로그인/토큰 발급 시 토큰을 **localStorage**에 저장.
- **페이지 진입 시**: 토큰 존재 → `[GET] /api/v1/users/me`로 유저 정보 수신 후 (로그인) 화면 / 토큰 없음 → (비로그인) 화면.
- **공용 Axios**: 토큰 존재 시 헤더 `{ Authorization: Bearer 토큰 }`.
  - **401**: SignatureVerificationException 또는 JWTDecodeException → "세션이 유효하지 않습니다." 팝업 + 로그아웃 / TokenExpiredException → "세션이 만료되었습니다." 팝업 + 로그아웃.
  - **403**: Forbidden → "접근 권한이 없습니다." 팝업 (로그아웃 없음).
- **로그아웃**: localStorage 토큰 삭제, "홈" 메뉴로 리프레시.

### 로딩 스피너
응답 완료까지 인터랙션 방지. 적용 화면: 홈>방목록 조회(전체/검색/정렬), 홈>방 상세정보, 지난 회의 이력.

### 입력 필드 유효성 체크
실패 시 입력 폼에 에러 메시지 표시.

### 네비게이션 (비로그인)
- 사이드 메뉴: **홈**만 표시.
- GNB에 **회원가입** 버튼(Default)·**로그인** 버튼(Primary) 표시.

### 네비게이션 (로그인)
- 메뉴: 홈 / 지난 회의 이력 / 로그아웃. 회원가입·로그인 버튼 숨김.

### 회원가입 팝업
- 헤더: "회원가입" + 닫기 아이콘.
- **소속**: 최대 30자("최대 30자까지 입력 가능합니다."), 선택.
- **직책**: 최대 30자, 선택.
- **이름**: 최대 30자, 필수("필수 입력 항목입니다.").
- **아이디**: 최대 16자, 필수, **중복 확인 버튼**(백엔드 API 호출) → 중복 시 "이미 존재하는 아이디입니다." / 가능 시 "사용 가능한 아이디입니다."
- **비밀번호**: 최소 9자("최소 9 글자를 입력해야 합니다.")·최대 16자·영문+숫자+특수문자 조합("비밀번호는 영문, 숫자, 특수문자가 조합되어야 합니다.")·필수.
- **비밀번호 확인**: 동일 규칙 + "입력한 비밀번호와 일치하지 않습니다."
- **가입하기 버튼**: 입력마다 유효성 체크 → 유효 시 활성화. 클릭 시 로딩 스피너 + 회원가입 API 호출. 성공 → 팝업 닫고 "회원가입이 완료되었습니다." / 실패 → 팝업 유지 "회원가입에 실패하였습니다."

### 로그인 팝업
- 헤더: "로그인" + 닫기 아이콘.
- **아이디**: 최대 16자, 필수.
- **비밀번호**: 최소 9자·최대 16자·영문+숫자+특수문자 조합·필수.
- **로그인 버튼**: 유효성 게이팅. 클릭 시 로딩 스피너 + 로그인 API. 성공 → 토큰 저장 + (로그인) 상태 전환 / 실패 → 팝업 유지 + 에러 메시지.

---

# Sub PJT Ⅱ — 방 CRUD + 미디어 인프라

## 1. 주요 개념

### WebSocket (SockJS + STOMP)
- 방 참여 시 채팅 + 미디어 서버 WebRTC 연결 메시지 송수신에 사용.
- **SockJS**: WebSocket Polyfill(미지원 브라우저는 HTTP Streaming/Polling). `const sock = new SockJS('api/v1/ws')`.
- **STOMP**: 텍스트 기반 메시지 프로토콜. 특정 Topic Subscribe → 해당 Topic으로 Send 시 구독자 모두 수신.
```javascript
const socket = new SockJS('api/v1/ws');
const stompClient = Stomp.over(socket);
stompClient.connect({}, function (frame) {
  stompClient.subscribe('/topic/greetings', function (msg) { console.log(msg); });
  stompClient.send('/topic/greetings', {}, 'Hello!');
});
```

### WebRTC / STUN / TURN / Kurento
- **WebRTC**: 브라우저 간 오디오/영상/데이터 교환. 시그널링(Signaling)으로 P2P 통신.
- **STUN**: UDP 기반, 클라이언트 Public IP 확인. **이번 프로젝트는 Kurento 미디어 서버를 Signaling Server로 활용.**
- **TURN**: NAT/방화벽 순회, 중개(릴레이) 서버 경유(STUN 확장).
- **Kurento 미디어 서버**: WebRTC 전체 사양 구현 패키지. 튜토리얼 `https://github.com/Kurento/kurento-tutorial-java`. (OpenVidu는 Kurento 기반 프레임워크 — 대안으로 사용 가능.)

### API 통합 테스트
- 도구: Insomnia/Postman 등. (로그인 응답에 `accessToken` 포함, `Authorization: Bearer <accessToken>` 헤더로 `/users/me` 호출.)

## 2. 개발 환경 설정 (인프라)

### Docker
- Windows: Docker Desktop. Ubuntu(AWS): `docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin` 설치.

### Kurento (미디어 서버) — 기본 포트 **8888**
```bash
sudo docker pull kurento/kurento-media-server:latest
sudo docker run -d --name kms --network host kurento/kurento-media-server:latest
```

### STUN/TURN 서버 (Coturn) — **로컬 불가, Public 서버/클라우드 필요**
인바운드 포트 허용:
```bash
sudo ufw allow 3478/udp
sudo ufw allow 3478/tcp
sudo ufw allow 49152-65535/udp
```
설치: `sudo apt-get install --no-install-recommends --yes coturn`
`/etc/default/coturn`: `TURNSERVER_ENABLED=1`
`/etc/turnserver.conf`:
```
listening-port=3478
tls-listening-port=5349
listening-ip=<EC2 프라이빗 IPv4>
external-ip=<EC2 퍼블릭 IPv4>/<EC2 프라이빗 IPv4>
relay-ip=<EC2 프라이빗 IPv4>
fingerprint
lt-cred-mech
user=myuser:mypassword
realm=myrealm
log-file=/var/log/turn.log
simple-log
```
재기동: `sudo service coturn restart`

### Kurento의 STUN/TURN 설정
Kurento 컨테이너 접속 후 `/etc/kurento/modules/kurento/WebRtcEndpoint.conf.ini`:
```
stunServerAddress=<EC2 퍼블릭 IPv4>
stunServerPort=3478
turnURL=myuser:mypassword@<EC2 퍼블릭 IPv4>?transport=udp
```

### Front-end 의존 라이브러리 (webjars 참조)
build.gradle (스켈레톤에 포함):
```gradle
implementation("org.springframework.boot:spring-boot-starter-mustache")
implementation('org.webjars.bower:jquery:3.3.1')
implementation('org.webjars:sockjs-client:1.1.2')
implementation('org.webjars:stomp-websocket:2.3.3-1')
implementation('org.webjars:webjars-locator:0.30')
implementation('org.webjars.bower:webrtc-adapter:7.4.0')
implementation('org.kurento:kurento-client:6.18.0')
implementation('org.kurento:kurento-utils-js:6.18.0')
```
`/frontend/index.html`에 script 추가:
```html
<script type="text/javascript" src="/webjars/webrtc-adapter/release/adapter.js"></script>
<script type="text/javascript" src="/group-call/js/kurento/lib/kurento-utils.js"></script>
<script type="text/javascript" src="/webjars/jquery/dist/jquery.min.js"></script>
<script type="text/javascript" src="/webjars/sockjs-client/sockjs.min.js"></script>
<script type="text/javascript" src="/webjars/stomp-websocket/stomp.min.js"></script>
```

### HTTPS 활성화 (WebRTC는 http 제약 → https 필요)
Self-Signed 인증서: `keytool -genkeypair -alias liveclass-web -keyalg RSA -keysize 2048 -storetype PKCS12 -keystore liveclass-web.p12 -validity 3650` (CN=GilDongHong, OU/O=부트캠프, L/ST=Seoul, C=KR)
`.p12`를 `src/main/resources/keystore`에 두고 application.properties:
```properties
server.port=8443
server.http.port=8080
server.ssl.enabled=true
server.ssl.key-store-type=PKCS12
server.ssl.key-store=classpath:keystore/liveclass-web.p12
server.ssl.key-store-password=입력한 비밀번호
server.ssl.key-alias=liveclass-web
trust.store=classpath:keystore/liveclass-web.p12
trust.store.password=입력한 비밀번호
```
`frontend/vite.config.js`: `server.https=true`, `port:8083`, proxy `/api/v1`·`/webjars`·`/group-call`·`/upload` → `https://localhost:8443/` (`changeOrigin:true, secure:false`). build `outDir: '../backend/src/main/resources/dist'`.

## 3. Back-end API — 회의실(방)

**[GET] /conference-categories** — 방 카테고리 조회 (권한: 로그인 사용자)
- Response 200: `[ {"id":1,"name":"업무"}, {"id":2,"name":"교육"}, {"id":3,"name":"기타"} ]`

**[POST] /conferences** — 방 생성 (권한: 로그인 사용자)
- Request: `{ "conferenceCategoryId":1, "title":"방 제목", "description":"방 설명" }` + FormData `file`(png/jpg 등 이미지)
- Response 201: `{ "statusCode":201, "message":"Success", "conferenceId":1 }`
- 기능: `call_start_time`=생성 시점, `call_end_time`=방장 종료 시점. 이미지는 임의 디렉토리 생성하여 `방ID/이미지파일명`으로 저장.

**[GET] /conferences** — 방 목록 (권한: 모든 사용자)
- Query: `title`(검색), `sort`(`call_start_time`/`title` asc|desc, 예 `sort=call_start_time,asc&sort=title,desc`), `page`, `size`, `conference_category`(예 `?conference_category=1`)
- Response 200 (Spring `Page`/`Pageable` 래핑):
```json
{
  "content": [
    { "id":1, "conference_category":"교육", "joinUsersNum":5, "owner":"User-1",
      "callStartTime":"DateTime", "thumbnail_url":"/1/image.png",
      "title":"방 제목", "description":"방 설명", "is_active":true }
  ],
  "empty":true,"first":true,"last":true,"number":0,"numberOfElements":0,
  "pageable":{"offset":0,"pageNumber":0,"pageSize":0,"paged":true,
    "sort":{"empty":true,"sorted":true,"unsorted":true},"unpaged":true},
  "size":0,"sort":{"empty":true,"sorted":true,"unsorted":true},
  "totalElements":0,"totalPages":0
}
```
- 기능: Pagination(Page/Pageable), title 검색, title·call_start_time 정렬.

**[GET] /conferences/<int:conference_id>** — 방 상세 (권한: 로그인 사용자)
- Response 200:
```json
{
  "id":1, "conference_category":"교육", "owner":"User-1",
  "callStartTime":"DateTime", "thumbnail_url":"/1/image.png",
  "title":"방 제목", "description":"방 설명", "is_active":true,
  "users":[ {"user_id":"test-1","name":"참여자 1"}, {"user_id":"test-2","name":"참여자 2"} ]
}
```

**[PATCH] /conferences/<int:conference_id>** — 방 수정 (권한: 로그인 사용자 + 해당 방 방장)
- Request: `{ "conference_category":1, "title":"방 제목", "description":"방 설명" }` + FormData `file`
- Response 200: `{ "statusCode":200, "message":"Success" }`
- 기능: 이미지는 `방ID/파일명`으로 저장.

> ⚠️ **필드명 표기 불일치 — 구현 전 계약 통일 필요** (OCR 아님, 명세 자체가 불일치): 목록/상세 응답은 snake(`conference_category`/`thumbnail_url`/`is_active`)와 camel(`joinUsersNum`/`callStartTime`)을 한 객체 안에서 혼용. 생성 Request는 `conferenceCategoryId`(camel), 수정 Request는 `conference_category`(snake). 위 JSON은 명세에 적힌 표기 그대로이며, 실제 구현에서는 프론트/백이 하나의 규칙(권장: camelCase)으로 합의해야 함.

## 4. Back-end — WebSocket / WebRTC
- **Websocket 채팅 서버**: SockJS+Stomp로 **SimpleBroker** 생성. 설계 완료 시 메시지 흐름/규격을 FE에 문서 공유.
- **WebRTC(Kurento)**: Docker로 Kurento 설치·실행, STUN/TURN 설정, GroupCall(many-to-many) 구현. 참고: `kurento-tutorial-java/.../kurento-group-call`.
- **심화**: 스티커(Kurento `FaceOverlayFilter`), 녹화(Kurento Recorder).

## 5. Front-end 요구사항 (Sub Ⅱ)

### 공용 WebSocket 모듈
- **SockJS** + **STOMP.js** 사용. 연결 예:
```javascript
var sockJS = new SockJS("api/v1/ws");
var stompClient = Stomp.over(sockJS);
stompClient.connect({ accessToken: "myJWTToken" }, successCallback, errorCallback);
// subscribe: stompClient.subscribe("/conferences/" + roomId, cb)
// send:      stompClient.send("/conferences/" + roomId + "/send", {}, "메시지")
```
- 제공 함수(API): `connect()`(STOMP connect 시 JWT를 `accessToken`에 전달), `send(<string:message>)`, `subscribe(<int:room_id>)`(방 URL Topic 구독), `unsubscribe(<int:room_id> or undefined)`(undefined=모든 방), `disconnect()`.
- 방장이 방 종료 시: 서버로부터 방 나가기 메시지 수신 → unsubscribe + WebRTC 종료 + "회의가 종료되었습니다." 팝업 후 홈 이동.

### 네비게이션 (로그인) / 생성하기·프로필
- 메뉴: 홈(`el-icon-s-home`)/지난 회의 이력(`el-icon-s-order`)/로그아웃(`el-icon-switch-button`).
- **생성하기 버튼**(Primary, `el-icon-circle-plus-outline`) → 생성하기 팝업. **프로필 버튼**(`el-icon-user-solid`) → 프로필 팝업.

### 생성하기 팝업
- **용도**: 드롭다운(백엔드 API로 카테고리 목록) — 업무(기본)/교육/기타.
- **제목**: 필수, 최대 30자.
- **설명**: 필수, TextArea.
- **썸네일**: 필수, 읽기전용 파일명 필드 + "찾아보기" 버튼. 확장자 png/jpg/jpeg/gif만("업로드 가능한 파일의 확장자는 png, jpg, jpeg, gif 입니다."), 최대 **2MB**("업로드 가능한 파일의 최대 사이즈는 2MB 입니다.").
- **생성 버튼**: 유효성 게이팅. 클릭 시 로딩 스피너 + 방 생성 API. 성공 → 응답 `conference_id`로 방 상세 진입 / 실패 → "컨퍼런스 생성에 실패하였습니다."

### 프로필 팝업
- 소속(선택, ≤30자), 직책(선택, ≤30자), 이름(필수, ≤30자), 아이디(읽기전용/비활성). 저장 버튼 → 유저 정보 수정 API. 성공 "프로필 수정이 완료되었습니다." / 실패 "프로필 수정에 실패하였습니다."

### 홈 > 방 목록
- **검색(데스크톱)**: GNB 검색 입력(`el-icon-search`, PlaceHolder "화상 컨퍼런스 제목 검색"). 엔터/버튼 클릭 시 검색 API. **검색(모바일)**: 검색 아이콘 → 검색 팝업.
- **정렬**: 버튼 그룹(시간/제목). 각 버튼 토글: 정렬없음(`el-icon-sort`) → 오름차순(`el-icon-sort-up`) → 내림차순(`el-icon-sort-down`) → 정렬없음. 기준 필드 `call_start_time`. 클릭마다 백엔드 API 호출.
- **방 목록(그리드)**: 카드형, 아이템 최소 가로 345px, 반응형 열(데스크톱 3~4/태블릿 2~3/모바일 1), Padding 데스크톱 20px/모바일 15px. **Infinite Scroll로 페이지네이션 20개씩**.
- **아이템**: 썸네일, 제목(1줄 clamp), 설명(3줄 clamp), 상태 Tag(활성=Success "진행중"/비활성=Danger "종료됨"), 참여인원 Tag("N명 참여중").
- **목록 없음**: Result로 "컨퍼런스 없음 / 존재하는 컨퍼런스가 없습니다. 새롭게 컨퍼런스를 생성하시거나 다른 제목으로 컨퍼런스를 검색해주세요."

### 방 상세 보기
- **진입 Flow**: 로딩 스피너 → `/conference/<int:conference_id>` API → 뷰 전환 → 네비게이션(방 상세) → 썸네일/제목/시작시간/설명 표시 → 화상·채팅 요소 표시 → 공용 WebSocket 연결 + subscribe(입장) → 대화방 정보 표시 → 스피너 숨김 → WebRTC 연결 → 영상 표시.
- **종료 Flow**: 로딩 스피너 → WebRTC 연결 해제 + Video/객체 초기화 → unsubscribe → WebSocket close → 스피너 숨김 → 네비게이션(로그인) → 방 목록 뷰.
- **네비게이션(방 상세)**: 검색/생성/프로필 숨김, "나가기 버튼"(Popconfirm "이 컨퍼런스를 종료하시겠습니까?" → 확인 시 종료 Flow). 모바일은 채팅 버튼(Drawer)·나가기(`el-icon-close`).
- **화상(Video)**: 반응형, 참여자별 16:9 (데스크톱 400×225 / 모바일 320×180), 모바일 1열.
- **채팅**: 가로 고정 260px, 대화방 스크롤, 하단 고정 입력필드(PlaceHolder "메시지 입력") + 전송 버튼(`el-icon-s-promotion` + "전송").
- **설명**: TextArea 줄바꿈(\n) 인식 표시.

---

# Sub PJT Ⅲ — 그룹 화상 콜 + 채팅 + 배포

## 1. Front-end 요구사항

### 방 상세 보기 — 진입/종료 Flow
- **진입 불가**: 방 인원 4명 → "참여 인원이 가득 찼습니다." / 방 비활성 → "이미 종료된 컨퍼런스입니다."
- **진입 Flow**(Sub Ⅱ와 동일) + **beforeunload 이벤트 등록**(새로고침/브라우저 닫기 시 WebSocket 연결 종료).
- **종료 Flow**(Sub Ⅱ와 동일) + **beforeunload 이벤트 해제**.
- 화면 설계: 참여자 그리드(**최대 4명**, 2×2), 채팅 영역(입장/퇴장/대화), 컨퍼런스 설명.

### 채팅 대화방 이벤트 (Element UI Plus)
- **입장**: "{사용자 이름} 님이 입장하셨습니다." (Body + Bold). 첫/마지막 메시지 아니면 Divider Basic.
- **퇴장**: "{사용자 이름} 님이 퇴장하셨습니다." (Body + Bold) + Divider.
- **대화**: 메시지 텍스트(Body). 상단 Divider Custom content(`content-position:right`에 사용자 이름, Small Title + Bold).
- **메시지 전송**: 입력필드(PlaceHolder "메시지 입력") 엔터/전송 버튼(`el-icon-s-promotion`) → 값 존재 시 WebSocket으로 서버 전송 + 필드 초기화.

### WebRTC Signaling (Front-end)
- **연결 URL**: `wss://localhost:8443/webrtc`
- **방 Join**: FE→서버 `{id:"joinRoom", accessToken:"인증토큰", conferenceId:1}`.
  - 서버→기존참여자 `{id:"newParticipantArrived", "name":"유저아이디"}`.
  - 서버→신규참여자 `{id:"existingParticipants", data:["유저아이디1","유저아이디2"]}`.
  - FE: `existingParticipants` 수신(=신규 참가자) → `kurentoUtils.WebRtcPeer.WebRtcPeerSendonly`(송신) 생성 + 기존 참여자마다 `WebRtcPeerRecvonly`(수신) 생성. `newParticipantArrived` 수신(=기존 참가자) → 신규 참가자용 `WebRtcPeerRecvonly` 생성.
- **이벤트 처리 예제 (원문)**:
```javascript
ws.onmessage = function(message) {
    var parsedMessage = JSON.parse(message.data);
    switch (parsedMessage.id) {
    case 'existingParticipants': onExistingParticipants(parsedMessage); break;
    case 'newParticipantArrived': onNewParticipant(parsedMessage); break;
    case 'participantLeft': onParticipantLeft(parsedMessage); break;
    case 'receiveVideoAnswer': receiveVideoResponse(parsedMessage); break;
    case 'iceCandidate':
        participants[parsedMessage.name].rtcPeer.addIceCandidate(parsedMessage.candidate, function (error) {
            if (error) { console.error("Error adding candidate: " + error); return; }
        });
        break;
    default: console.error('Unrecognized message', parsedMessage);
    }
}
```
- 송신 Peer 옵션(원문): `mediaConstraints { audio:true, video:{ mandatory:{ maxWidth:320, maxFrameRate:15, minFrameRate:15 } } }`, `iceServers:[{ urls:'turn:54.180.26.236:3478?transport=udp', username:'myuser', credential:'mypassword' }]`, `WebRtcPeerSendonly` → `generateOffer`. 수신 Peer는 `WebRtcPeerRecvonly`.
- **방 Exit**: FE→서버 `{id:"leaveRoom"}`. 서버→타참여자 `{id:"participantLeft", name:"유저아이디"}`. FE: `participantLeft` 수신 시 해당 참여자 `rtcPeer.dispose()` + 리스트 삭제.

### 지난 회의 이력
- Element UI Plus Data-Table, 한 페이지 20개, 최근 활동 시간순.
- 컬럼: 활동(생성/참여/종료), 활동 시간(예 "2021년 6월 30일 오후 2시 24분 30초"), 제목, 설명, 시작 시간, 종료 시간(없으면 미표시).
- 페이지네이션(Pagination Basic usage, 하단 가운데, 여백 데스크톱 24px/모바일 12px, 이전/페이지수/다음).

## 2. Back-end 요구사항

### 지난 회의 이력
**[GET] /histories** (권한: 로그인 사용자)
- Request: 없음. Response 200 (Pagination):
```json
{
  "content": [
    { "id":1,
      "conference": { "conference_category":"교육", "call_start_time":"DateTime",
        "call_end_time":"DateTime", "thumbnail_url":"/1/image.png",
        "title":"회의 방 1", "description":"회의 방 설명", "is_active":false },
      "action":0,               // 0-생성, 1-참여, 2-종료
      "inserted_time":"DateTime" // 업데이트 시간
    }
  ],
  "empty":true,"first":true,"last":true,"number":0,"numberOfElements":0,
  "pageable":{...},"size":0,"sort":{...},"totalElements":0,"totalPages":0
}
```
- 기능: Pagination, 요청 User의 `conference_history`만, `inserted_time` 최신순.

### WebSocket 채팅 서버 (STOMP)
- **연결 URL**: `/api/v1/ws`. 연결 시 Client 토큰 유효성 체크 — 유효하면 유지, 아니면 끊음. 예: `stompClient.connect({ accessToken:"인증 토큰" }, onConnectCallback)`.
- **Topic**: `/conference/<int:id>`(방 채팅 메시지 수신). **Send**: `/conference/<int:id>/send`.
- **방 Join**: FE가 `/conference/<int:id>` Subscribe → 서버 **ChannelInterceptor**가 감지, 방에 "<User ID> 님이 입장하셨습니다." 전송. Connect 시 Header로 사용자 인식. 해당 방 `user_conference` 생성.
- **방 Exit**: FE가 Unsubscribe/Disconnect → 서버가 "<User ID> 님이 나가셨습니다." 전송. `user_conference` 삭제.
- **방장 퇴장**: 모든 사용자 Exit(WebSocket Exit 메시지) + `user_conference` 삭제 + 방 `is_active=false` + FE는 홈 이동.
- **메시지 전송**: FE가 `/conference/<int:id>/send`로 전송 → 서버가 `/conference/<int:id>`로 브로드캐스트.

### WebRTC Signaling Server
- **연결 URL**: `wss://localhost:8443/webrtc`.
- **방 Join**: `joinRoom` 메시지의 accessToken/conferenceId로 유저 인증 → `KurentoClient::createMediaPipeline`으로 room 생성/조회 → 해당 room의 MediaPipeline을 가지는 WebRTC 유저 세션 생성 → 기존 참여자에 `newParticipantArrived`, 신규 참여자에 `existingParticipants` 전달.
- **방 Exit**: `leaveRoom` 수신 → 세션 식별 → 미디어 서버에서 release → 타참여자에 `participantLeft` 전달.

## 3. 배포 및 실행 가이드
- **빌드**: `/backend`에서 `.\gradlew clean build` → `build/libs/*.jar`.
- **init.sql**: `create database IF NOT EXISTS liveclass_web_db collate utf8mb4_general_ci;`
- **Dockerfile**:
```dockerfile
FROM eclipse-temurin:11-jdk-alpine
WORKDIR /app
COPY --from=build /app/app.jar app.jar
COPY --from=build /app/backend/upload upload/
ENTRYPOINT ["java", "-jar", "app.jar"]
```
- **docker-compose.yml** (요지): `db`(mysql:8.0.39, `33060:3306`, volume `./db:/docker-entrypoint-initdb.d`), `kurento`(kurento/kurento-media-server:6.18.0, `8888:8888`, env `KMS_STUN_IP`/`KMS_STUN_PORT:3478`/`KMS_TURN_URL: myuser:mypassword@<퍼블릭IP>:3478?transport=udp`), `app`(build backend/Dockerfile, `8080:8080`+`8443:8443`, `SPRING_PROFILES_ACTIVE:docker`, depends_on db·kurento), network `backend`.
- **배포**: FileZilla(SFTP)로 EC2 업로드 — `db/init.sql`, `Dockerfile`·`docker-compose.yml`, `build/libs/*.jar`.
- **실행**: EC2에서 `docker-compose up -d`.

## 4. 심화 학습
**심화 기능**: 1) 토큰 인증 기반 로그아웃(토큰 DB 저장·유효성 체크) 2) 비밀번호 재설정/변경 3) 발언자 하이라이팅 4) 방 정보 수정(방장) 5) 방 공유하기(링크) 6) 방 접근 제한(비밀번호) 7) 공개 컨퍼런스(익명 참관).
**서비스 아이템**: 1:1 영어 튜터링, 온라인 면접, 온라인 강의, 원격 진료, 온라인 행사, 협업 툴, 그룹 영상 SNS.

---

*추출: 이미지 PDF → OCR/전사. 명백한 OCR 오타는 교정, 세부 화면 좌표·스크린샷은 생략. 요구사항/API/규격은 원문 유지.*
