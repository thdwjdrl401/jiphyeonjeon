# ADR-0009: 백엔드 = Java 21 + Spring Boot 4.1

> 📍 하네스 개요: [../harness/README.md](../../harness/README.md) · 아키텍처: [../ARCHITECTURE.md](../../ARCHITECTURE.md)

- **상태**: 채택 (**개정 2026-07-16**: 3.4/3.5 → **4.1**. 최초 결정은 아래 "개정 사유")
- **일자**: 2026-07-14 (개정 2026-07-16)
- **관련**: [0006](0006-backend-spring-plus-python-ai.md), [0014](0014-auth-redis-session-cookie.md)

## 맥락
백엔드는 Spring(Java) 확정([0006](0006-backend-spring-plus-python-ai.md)). Java 21(virtual threads)은 확정. Spring Boot 라인을 어디로 고정할지가 쟁점.

## 결정
**Java 21 (LTS) + Spring Boot 4.1** 채택.

## 근거 (2026-07-16 실측)
- **Spring Boot엔 LTS가 없다** — 마이너마다 OSS(무상) 지원 ~13개월. LTS 축은 Java(=21) 쪽.
- **수명주기가 결정적**: 2026-07 기준 **3.3·3.4는 EOL, 3.5는 OSS-EOL(2026-06-30 종료)**. 3.x로 그린필드 시작 = **첫날부터 무상 보안패치 0**(유상 Tanzu 구독 없으면).
- **4.1 = 무상 지원 최장**(~2027-07-31), 4.x의 2번째 마이너라 **첫 4.0 점프의 리스크는 지나간 안착 버전**.
- **생태계 검증 완료** — 우리 스택 전부 Boot 4.1 릴리스 존재: springdoc-openapi 3.0.x, LiveKit `livekit-server:0.14.0`, `hibernate-vector:7.4.1`, Lombok 1.18.46, Flyway 12.4, Spring AMQP 4.1, Apache POI 5.5. **Jackson 3가 패키지 네임스페이스를 바꿔(`tools.jackson.*`) 옛 Jackson 2 라이브러리와 클래스패스 공존** → "옛 라이브러리가 깨진다" 리스크 해소.
- **그린필드라 마이그레이션 비용 0** — 처음부터 4.x 관례로 작성.

## 개정 사유 (원 결정 무효화)
최초(2026-07-14)엔 "VT는 Boot 3.2+에서 이미 되니 3.4/3.5 stable"로 정했다. VT 근거는 맞지만 **지원 수명주기를 보지 않았다.** 2026-07 재검토에서 3.4·3.5가 이미 OSS-EOL임이 확인되어 결정을 뒤집는다.

## 대안
| 대안 | 장점 | 단점 |
|---|---|---|
| **4.1 (선택)** | 무상 지원 최장·현행·생태계 검증됨 | 신생이라 Q&A 자료 적음(AI 툴링으로 완화) |
| 3.5 | 자료 최다·안정 | **OSS-EOL**(무상 보안패치 없음) — 신규엔 부적합 |
| 4.0 | 8개월 성숙 | 무상 지원 ~2026-12뿐(곧 4.1로 밀림) |

## 영향·후속
- **툴체인**: Gradle **8.14+/9.x**(wrapper 고정), Jackson **3**, Jakarta EE **11**, Hibernate **7**, Spring Framework **7**.
- **생태계 핀**: `hibernate-vector`는 Boot BOM의 Hibernate 버전과 **정확히 일치**시켜 핀(현재 7.4.1). springdoc은 **v3.0.x**(v2.8 아님). LiveKit 토큰은 SDK 또는 JWT 직접 서명(둘 다 4.1 OK).
- **주의**: Testcontainers **2.x**(1.x 튜토리얼과 API 상이). 팀 온보딩: 최신 IDE + JDK 21.
- 컨트롤 플레인은 MVC + virtual threads, 외부 AI/미디어 호출은 blocking 클라이언트. reactive/JPA 혼합 회피.
