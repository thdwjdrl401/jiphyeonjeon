# ADR-0023: Spring→AI RAG 호출에 요청 범위를 묶은 단명 JWT를 사용한다

- **상태**: Proposed — Spring 담당 검토 결과 **MVP는 HMAC 공유 시크릿으로 간소화 역제안**(아래 §9), AI 합의 필요. RS256 JWT(§1~§8)는 phase-2 목표로 보존.
- **일자**: 2026-07-27
- **범위**: Spring → `ai-api`의 `POST /internal/v1/rag/answers:stream`
- **구현 제한**: 이 ADR은 팀 검토용 후보 결정이며 Java 구현 완료나 공유 계약 확정을 의미하지 않는다.
- **관련 결정**: [songjeongki ADR-0014](../songjeongki/0014-auth-redis-session-cookie.md),
  [ai-api ADR-0001](../../../ai/ai-api/docs/decisions/0001-rag-answer-core-boundary.md)

## 1. 의사결정 요약

Spring이 사용자 인증·수강 권한·비용 정책을 확인한 직후, **호출 한 건의 레슨·세션·요청 범위를 담은
30초짜리 JWT**를 발급한다. `ai-api`는 Spring의 공개키로 서명과 claim을 검증하고 요청 body의 식별자와
대조한 뒤에만 RAG 처리를 시작한다.

| 항목 | 제안 결정 | 선택 이유 |
|---|---|---|
| 서명 알고리즘 | `RS256`만 허용 | Spring만 발급하고 Python은 검증만 하도록 권한 분리 |
| 키 전달 | private/public PEM을 각 컨테이너에 read-only 파일 mount | PEM 개행 문제를 피하면서 MVP 배포를 단순하게 유지 |
| 키 식별 | JWT header의 `kid` 필수, 설정에 등록된 값만 허용 | 키 교체 경로를 열고 임의 키 조회를 차단 |
| 토큰 종류 | `typ=liveclass-internal+jwt` | LiveKit 등 다른 JWT와의 혼동 방지 |
| 발급자 | `iss=liveclass-backend` 정확히 일치 | 신뢰할 발급자 고정 |
| 수신자 | `aud=liveclass-ai-api` 정확히 일치 | 다른 내부 서비스용 토큰 전용 방지 |
| 권한 | `scope=rag:answer` 정확히 일치 | RAG stream 한 기능에만 최소 권한 부여 |
| 시간 | `iat` 필수, `exp=iat+30초`, clock skew 5초, `nbf` 미사용 | 즉시 S2S 호출에 충분한 여유와 짧은 탈취 가능 시간의 균형 |
| 요청 binding | `lessonId`, `sessionId`, `requestId`를 claim과 body에서 일치 검증 | Spring이 승인한 자료·자막 범위를 Python까지 보존 |
| 토큰 식별 | 요청마다 UUID `jti` 발급 | 추적성과 후속 replay 방지 확장점 확보 |
| replay 저장소 | 첫 MR에서는 두지 않음 | SSE 재연결·멱등 정책 없이 토큰만 1회 소비하면 복잡도 대비 효과가 제한적 |
| 테스트 | 고정 테스트 키 + 동적 signing fixture | 실제 시간 경과로 만료되지 않으면서 실패 claim을 독립 검증 |

### 승인 요청 사항

| 승인 주체 | 확인할 내용 | 미합의 시 영향 |
|---|---|---|
| Spring 담당 | 알고리즘, header, claim 이름·타입, TTL·skew | Python 실제 인증기 배선 불가, endpoint는 `503` 유지 |
| AI 담당 | 공개키 설정, claim/body 대조, 실패 상태와 테스트 fixture | 유효한 Spring 호출을 판별할 수 없음 |
| 양측 | 재시도 때 새 `requestId`를 만들지, 기존 값을 유지할지 | request 멱등·SSE 재연결 정책 확정 불가 |
| 인프라 담당 | private/public key 생성·mount·교체 절차 | 운영 배포에서 신뢰키 공급 불가 |

## 2. 배경과 목표

브라우저 인증은 Spring의 HttpOnly 쿠키·Redis 세션에서 끝난다. Python은 사용자 세션을 직접 해석하지 않고,
Spring이 검증한 호출만 받는 별도 S2S 경계다. 현재 `ai-api`에는 인증 protocol만 있고 실제 인증기가 없으면
RAG endpoint를 `503`으로 닫는다.

이번 결정의 목표는 다음과 같다.

| 목표 | 설명 |
|---|---|
| 발급 권한 분리 | Python에 Spring 토큰을 새로 만들 수 있는 비밀을 주지 않는다. |
| 최소 권한 | 토큰 하나가 특정 RAG 기능과 특정 레슨·세션 범위에서만 유효해야 한다. |
| 짧은 유효기간 | 유출된 Bearer token의 사용 가능 시간을 제한한다. |
| 명확한 상호 운용 | Java가 발급한 토큰을 Python이 같은 규칙으로 검증함을 fixture로 증명한다. |
| 빠른 MVP | JWKS·분산 replay registry·응답 재생처럼 아직 필요하지 않은 운영 복잡도를 미룬다. |

JWT는 암호화가 아니라 서명된 claim 묶음이므로 질문·사용자 개인정보·비밀값은 넣지 않는다. 전송 구간은 TLS를
전제로 하며 로그에는 Authorization header나 JWT 원문을 남기지 않는다.

## 3. 대안 비교

### 3.1 서명 알고리즘

| 선택지 | 발급/검증 권한 | 장점 | 비용·위험 | 판단 |
|---|---|---|---|---|
| `HS256` | Spring과 Python이 같은 secret 공유 | 구현과 설정이 가장 단순 | Python도 정상 토큰 발급 가능, secret 회전 시 양측 동시 교체 | 제외 |
| `RS256` | Spring private key, Python public key | 권한 분리, Java/Python 지원과 운영 경험이 넓음 | RSA key pair와 Python crypto 의존성 필요 | **선택** |
| `ES256` | Spring private key, Python public key | 작은 키와 서명 | ECDSA key 형식·구현 호환성 검증 부담, 현재 트래픽에서 크기 이점이 작음 | 보류 |
| `EdDSA` | Spring private key, Python public key | 작은 키, 현대적 알고리즘 | 현재 Java/Python 라이브러리 조합과 배포 환경을 추가 검증해야 함 | 보류 |

`ai-api`는 `alg` header를 신뢰해 검증 알고리즘을 선택하지 않는다. 설정된 `RS256` allowlist와 다른 `alg`,
`none`, 대칭/비대칭 알고리즘 혼동을 모두 거부한다. RSA key는 최소 2048 bit로 생성한다.

### 3.2 검증키 전달

| 선택지 | 장점 | 비용·위험 | 판단 |
|---|---|---|---|
| PEM을 환경변수에 직접 저장 | compose 설정 항목이 적음 | multiline escape, 잘못된 개행, 환경 출력·디버그 로그 노출 가능 | 제외 |
| read-only PEM 파일 mount | 형식이 안정적이고 private/public key 배포를 분리하기 쉬움 | 교체 시 mount 갱신과 재배포 필요 | **선택** |
| JWKS endpoint | 여러 키와 무중단 rotation에 유리 | Java endpoint, Python cache·timeout·장애 정책 필요 | 운영 확장 시 채택 검토 |
| 토큰의 `jku`/`x5u`를 따라 조회 | 발급자가 키 위치를 동적으로 지정 | 임의 URL 조회에 따른 SSRF·신뢰키 우회 위험 | 금지 |

후보 설정은 다음과 같다. 이름은 양측 설정 구현 시 최종 확정한다.

```text
Spring: AI_INTERNAL_JWT_PRIVATE_KEY_PATH=/run/secrets/ai-internal-jwt-private.pem
Python: AI_INTERNAL_JWT_PUBLIC_KEY_PATH=/run/secrets/ai-internal-jwt-public.pem
양측:   AI_INTERNAL_JWT_KEY_ID=ai-s2s-2026-01
```

운영 private key는 Spring에만 공급한다. 공개키는 기밀은 아니지만 신뢰 설정이므로 image에 내려받거나 토큰이
지시한 위치에서 조회하지 않고, 배포 시 승인된 파일로 주입한다.

### 3.3 발급자·수신자·권한

| 검증 수준 | 방어 범위 | 남는 문제 | 판단 |
|---|---|---|---|
| 서명만 검증 | 위조 JWT | 같은 키로 서명한 다른 목적의 JWT를 전용할 수 있음 | 불충분 |
| `iss` 추가 | 다른 발급자 차단 | 같은 발급자의 다른 서비스용 JWT 구분 불가 | 불충분 |
| `iss + aud` | 다른 수신자용 JWT 차단 | 같은 AI 서비스의 다른 기능을 구분하지 못함 | 불충분 |
| `iss + aud + scope` | 발급자·수신자·허용 기능을 모두 제한 | claim 세 개의 양측 합의 필요 | **선택** |

`scope=internal`처럼 넓은 권한을 만들지 않는다. 이번 endpoint는 `rag:answer` 하나만 허용하며, 이후 기능은
`material:download`처럼 별도 scope를 정의한다. `sub`는 호출자가 항상 Spring으로 고정되고 `iss`와 별개로
표현할 주체가 없으므로 넣지 않는다.

### 3.4 유효 시간

| 선택지 | 장점 | 비용·위험 | 판단 |
|---|---|---|---|
| 5~10초 | 탈취 가능 시간이 가장 짧음 | 일시적 지연과 시계 차이에 지나치게 민감 | 제외 |
| 30초 | 즉시 호출에 충분하고 노출 시간도 짧음 | 만료 후 재시도에는 새 토큰 필요 | **선택** |
| 60초 | 운영 지연 허용 폭이 큼 | 현재 동기 호출에는 필요 이상의 유효 시간 | 대안 |
| 5분 이상 | 재사용과 수동 시험이 편함 | 단명 S2S token의 보안 목적이 약해짐 | 제외 |

`nbf`는 예약 발급 요구가 없는 즉시 호출에서 별도 가치를 주지 않고 시계 오차 실패만 늘리므로 사용하지 않는다.
SSE는 handshake 시점에 한 번 인증한다. 유효한 연결을 시작한 뒤 `exp`가 지나도 진행 중 stream을 끊지 않는다.

### 3.5 요청 범위 binding

| 선택지 | 보호 범위 | 비용·위험 | 판단 |
|---|---|---|---|
| ID claim 없음 | endpoint 호출 여부만 인증 | body를 다른 레슨·세션으로 바꿀 수 있음 | 제외 |
| `lessonId`만 포함 | PPTX 자료 범위 | 다른 caption session으로 변경 가능 | 불충분 |
| `lessonId + sessionId` | 자료와 자막 범위 | 요청 식별자를 바꾼 중복 호출 구분이 약함 | 불충분 |
| 세 ID 모두 포함 | 자료·자막·호출 식별 범위 | claim/body 대조 필요 | **선택** |
| 전체 body hash 포함 | 질문과 시간까지 완전 binding | Java/Python 간 canonical JSON 규칙과 hash 입력 계약 필요 | 보류 |

Spring은 token을 발급하기 전에 사용자에게 해당 `lessonId`·`sessionId` 접근 권한이 있고 두 ID가 서로 연결되는지
확인한다. Python은 그 권한을 DB에서 다시 조회하지 않고, 서명된 claim과 body가 정확히 같은지만 확인한다.

### 3.6 `jti`와 재사용 방지

| 선택지 | 장점 | 비용·위험 | 판단 |
|---|---|---|---|
| `jti` 없음 | 완전 무상태 | token 단위 추적과 후속 replay 방지 확장점 없음 | 제외 |
| `jti` 필수, 저장소 없음 | 추적 가능, 계약을 유지한 채 후속 확장 가능 | 유효기간 안의 동일 token replay는 허용 | **MVP 선택** |
| Redis `SET NX`로 `jti` 1회 소비 | 동일 token replay 차단 | Redis가 인증 가용성에 추가되고 재연결 시 새 token이 필요 | 후속 검토 |
| `requestId` 멱등 registry | 새 token으로 재시도한 중복 모델 비용까지 방지 | 진행 중 요청·완료 응답 재생·TTL·다중 replica 정책 필요 | 후속 결정 |

`jti` 1회 소비만으로는 Spring이 새 token을 발급한 동일 `requestId` 요청을 막지 못한다. 따라서 실제 중복 비용
방지는 SSE 재연결 정책과 `requestId` registry를 함께 설계해야 한다. 첫 MR은 30초 TTL과 세 ID binding으로
노출 범위를 제한하고, `jti`는 UUID 존재·형식만 검증한다.

## 4. 후보 wire profile

### 4.1 JWT header

```json
{
  "alg": "RS256",
  "typ": "liveclass-internal+jwt",
  "kid": "ai-s2s-2026-01"
}
```

### 4.2 JWT claims

```json
{
  "iss": "liveclass-backend",
  "aud": "liveclass-ai-api",
  "scope": "rag:answer",
  "iat": 1785120000,
  "exp": 1785120030,
  "jti": "92cf0b61-78c8-47bf-9412-9df232426da0",
  "lessonId": "11111111-1111-4111-8111-111111111111",
  "sessionId": "session-1",
  "requestId": "request-1"
}
```

| 필드 | 타입·제약 | 검증 규칙 |
|---|---|---|
| `alg` | header string, `RS256` | allowlist와 정확히 일치 |
| `typ` | header string, `liveclass-internal+jwt` | 정확히 일치 |
| `kid` | header string | 로컬 설정에 등록된 key ID와 일치, 미지의 값 거부 |
| `iss` | string, `liveclass-backend` | 정확히 일치 |
| `aud` | string, `liveclass-ai-api` | 정확히 일치, 배열형은 후보 v1에서 허용하지 않음 |
| `scope` | string, `rag:answer` | 정확히 일치, 공백 구분 복수 scope는 후보 v1에서 허용하지 않음 |
| `iat` | UTC Unix seconds 정수 | 현재보다 5초 초과 미래면 거부 |
| `exp` | UTC Unix seconds 정수 | 만료 검증, `exp > iat`, `exp - iat = 30` 검증 |
| `jti` | UUID string | 필수·형식 검증, 후보 v1에서는 저장소 조회 없음 |
| `lessonId` | UUID string | body의 `lessonId`와 UUID 값 기준 일치 |
| `sessionId` | 1~128자 identifier | body의 `sessionId`와 문자열 일치 |
| `requestId` | 1~128자 identifier | body의 `requestId`와 문자열 일치 |

### 4.3 실패 계약

| 조건 | HTTP | 외부 응답 | 내부 처리 |
|---|---:|---|---|
| Authorization 없음·Bearer 형식 오류 | `401` | `invalid internal credentials` | RAG adapter 미호출 |
| 서명·`alg`·`typ`·`kid` 오류 | `401` | 동일한 일반 메시지 | 상세 사유는 token 없이 구조화 로그 |
| `iss`·`aud`·`scope` 오류 | `401` | 동일한 일반 메시지 | RAG adapter 미호출 |
| `iat`·`exp`·필수 claim 오류 | `401` | 동일한 일반 메시지 | RAG adapter 미호출 |
| claim/body ID 불일치 | `401` | 동일한 일반 메시지 | RAG adapter 미호출 |
| 공개키·인증기 미설정 | `503` | 인증 설정 미완료 | fail closed |

인증 실패 원인을 응답에서 구분하지 않아 token probe에 정보를 주지 않는다. JWT 원문, signature, private key,
질문과 사용자 개인정보를 로그에 기록하지 않는다.

## 5. 테스트 전략

고정 JWT 문자열 하나를 일반 테스트의 기준으로 사용하면 실제 시간이 지나 `exp`가 만료되고 실패한다. 테스트 전용
RSA key pair와 주입 가능한 clock으로 매 테스트가 필요한 claim을 서명한다.

| 계층 | fixture | 확인할 내용 |
|---|---|---|
| Python 단위 테스트 | 고정 test public/private key + 동적 signer + frozen clock | 서명, header, claim, 시간, body binding 분기 |
| Python endpoint 계약 테스트 | 유효·무효 Bearer token | 인증 성공 시 SSE `200`, 실패 시 adapter 미호출과 `401` |
| Java 단위 테스트 | 동일 claim profile을 만드는 test signer | header·claim 이름·타입·TTL 고정 |
| 양측 호환 테스트 | 고정 test key·고정 시각·canonical claims로 만든 golden JWT 1개 | Java 발급 결과를 Python이 검증할 수 있음 |

최소 회귀 행렬은 다음과 같다.

| 분류 | 필수 사례 |
|---|---|
| 정상 | 모든 claim과 body가 일치하면 SSE `200` |
| 서명 | 다른 키, 손상된 signature, `alg=none`, `HS256` 혼동 |
| 목적 | 잘못되거나 누락된 `typ`, `kid`, `iss`, `aud`, `scope` |
| 시간 | 만료, 5초를 넘는 미래 `iat`, 잘못된 수명, 누락된 `iat`·`exp` |
| binding | `lessonId`, `sessionId`, `requestId` 각각의 불일치 |
| 설정 | 공개키 또는 인증기 미배선 시 `503` |
| 안전 | 모든 인증 실패에서 retriever/model 미호출, token 원문 미로그 |

## 6. 영향과 위험 관리

| 영향·위험 | 평가 | 대응 |
|---|---|---|
| Python이 token 발급 권한을 갖지 않음 | 긍정 | private key를 Spring에만 공급 |
| token마다 RSA 검증 비용 발생 | 낮음 | 내부 RAG 호출량에서는 네트워크·모델 비용보다 충분히 작음 |
| static key 교체 시 재배포 필요 | 수용 | `kid`를 지금 포함하고 무중단 rotation 필요 시 JWKS 도입 |
| token 유효기간 안 동일 JWT replay 가능 | 제한적 잔여 위험 | 30초 TTL·요청 binding·TLS 적용, 후속 registry에서 보강 |
| 서버 시계 차이로 정상 token 거부 가능 | 낮음 | 5초 skew와 운영 시각 동기화 적용 |
| ID만 묶어 질문 내용은 바꿀 수 있음 | 수용 | 질문은 권한 scope가 아니며 내부 TLS 경계, 필요 시 body hash 별도 결정 |
| 인증 설정 장애가 RAG 가용성에 영향 | 의도된 fail closed | readiness와 설정 검증으로 배포 전에 탐지 |

## 7. 적용 순서와 완료 조건

| 순서 | 담당 | 산출물 | 완료 조건 |
|---:|---|---|---|
| 1 | Spring·AI | 이 ADR의 값 승인 또는 수정 | 알고리즘·header·claim·TTL·재시도 정책 서면 합의 |
| 2 | 공통 계약 | `docs/CONTRACT.md` 갱신 | 후보가 아닌 공유 계약으로 승격, 양측 책임 명시 |
| 3 | Spring | 단명 JWT 발급기와 proxy 계약 테스트 | 확정 fixture와 동일한 token 생성 |
| 4 | AI | `InternalRequestAuthenticator` 구현·runtime 배선 | 정상 Spring token은 SSE `200`, 잘못된 token은 `401` |
| 5 | 양측 | golden fixture 상호 운용 검사 | Java 발급 token을 Python 검증기가 수용 |
| 6 | 후속 | request 멱등·SSE 재연결 결정 | 필요 시 Redis registry와 replay 정책 ADR 추가 |

Spring이 후보 profile을 채택하기 전에는 Python이 값을 임의 확정하거나 운영 인증기를 활성화하지 않는다. 채택 시
공유 `docs/CONTRACT.md`, 양측 계약 테스트와 관련 README를 같은 계약 변경에서 갱신한다.

## 8. 최종 승인 체크리스트

| 질문 | 제안 답변 | 승인/수정 |
|---|---|---|
| Python에 Spring token 발급 능력을 허용할 것인가? | 아니오 — `RS256` 공개키 검증만 허용 | ☐ |
| MVP에서 JWKS가 필요한가? | 아니오 — read-only PEM mount 사용 | ☐ |
| token은 어떤 기능에 유효한가? | `aud=liveclass-ai-api`, `scope=rag:answer` | ☐ |
| token 수명은 얼마인가? | 30초, skew 5초, `nbf` 없음 | ☐ |
| 승인한 resource 범위를 어떻게 보존하는가? | 세 ID를 claim과 body에서 일치 검증 | ☐ |
| 첫 MR에서 token을 1회 소비하는가? | 아니오 — `jti`만 포함하고 request registry와 함께 후속 결정 | ☐ |
| 양측 호환성을 무엇으로 증명하는가? | 고정 test key·clock·claims 기반 golden JWT | ☐ |

## 9. Spring 합의 (2026-07-27) — MVP는 HMAC 공유 시크릿으로 간소화

Spring 담당(송정기) 검토 결론: **§1~§8의 RS256 JWT는 이 단계에 과하다.** Spring↔`ai-api`는 같은 호스트·같은
Docker 내부망의 S2S이고 RAG 엔드포인트는 외부 비노출이라, RS256의 핵심 이점인 "AI가 Spring 토큰 위조 불가"는
**한계 이득**이다(AI가 털렸으면 이미 pgvector·MinIO까지 내부다). 반면 RSA 키 생성·PEM 2종 mount·`kid`·회전·JWKS는
**실제 운영 비용**이다. 게다가 임베딩 콜백·download-url이 **이미 HMAC**(`AiCallbackVerifier`)이라, RAG만 JWT로 가면
S2S 인증을 두 모델로 유지해야 한다.

**결정(MVP)**: 기존 HMAC 패턴을 재사용한다. 시크릿은 `.env`로 주입(dev 기본값, prod 주입) — RSA 키·PEM 불필요.

### 9.1 간소화 wire 계약

```text
POST /internal/v1/rag/answers:stream
Header: X-Internal-Signature: base64(HMAC-SHA256(AI_INTERNAL_SECRET, rawBody))
Body(JSON): { lessonId, sessionId, requestId, issuedAtMs, question, ... }
```

- **서명**: 요청 **원시 body 전체**를 HMAC-SHA256으로 서명(콜백/ download-url과 동일 방식). body가 곧 서명 대상이라
  claim↔body 대조·JWT claim(`iss`/`aud`/`scope`/`typ`/`kid`/`jti`)·alg allowlist가 **전부 불필요**하다(위·변조 시 서명 깨짐).
- **신선도**: body의 `issuedAtMs`로 `now - issuedAtMs > 60초`면 거부(늦은 캡처 재사용 차단). 단명 효과를 클레임 없이 확보.
- **범위 바인딩**: `lessonId`·`sessionId`·`requestId`는 body에 있고 서명이 덮으므로 자동 보존. Spring은 **발급 전** 사용자
  권한을 검증하고(`LiveAccessGuard`·`LessonPlaybackAccess`), `ai-api`는 서명만 확인하고 body를 신뢰한다.
- **시크릿**: `AI_INTERNAL_SECRET`(Spring·ai-api 공유, `.env`). 콜백용 `AI_CALLBACK_SECRET`과 별도 값 권장(재사용도 무방).

### 9.2 유지 (메커니즘 무관 알맹이 — §3~§4에서 그대로 채택)

- `lessonId`/`sessionId` 범위 바인딩(위처럼 body 서명으로), 짧은 신선도 창(60초), **fail-closed 503**(시크릿 미설정),
  실패 원인 비노출 **일반 401**, 엔드포인트 **내부 전용**, Authorization/원문·질문·개인정보 **로그 금지**.

### 9.3 폐기 (MVP에서 안 함)

RS256 keypair·PEM mount·`kid`·JWKS·alg confusion 처리·`jti`·`exp-iat` 정확검증·`iss`/`aud`/`scope`/`typ` 클레임.
단일 공유 시크릿 + body 서명으로 충분하다.

### 9.4 phase-2 승격 조건 (그때 §1~§8 채택)

AI 서비스가 **다른 호스트/외부망**으로 이동하거나, 내부 소비자가 **여럿**이 되어 발급/검증 권한 분리가 실제로
필요하거나, 감사·규제로 issuer/verifier 분리가 요구될 때. 그전까지 §1~§8은 로드맵으로 보존한다.

> AI 담당(유채은) 확인 필요: 위 간소화(HMAC 공유 시크릿) 채택 여부. 합의되면 `docs/CONTRACT.md`에 이 wire 계약을
> 올리고 Spring 발급기·ai-api 검증기·양측 계약 테스트를 같은 변경에서 구현한다.

## 참고

- [RFC 7519 — JSON Web Token](https://www.rfc-editor.org/rfc/rfc7519.html)
- [RFC 7518 — JSON Web Algorithms](https://www.rfc-editor.org/rfc/rfc7518.html)
- [RFC 8725 — JSON Web Token Best Current Practices](https://www.rfc-editor.org/rfc/rfc8725.html)
