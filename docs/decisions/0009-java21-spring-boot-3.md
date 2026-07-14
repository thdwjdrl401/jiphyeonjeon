# ADR-0009: 백엔드 = Java 21 + Spring Boot 3.4/3.5

> 📍 하네스 개요: [../harness/README.md](../harness/README.md) · 아키텍처: [../architecture.md](../architecture.md)

- **상태**: 채택
- **일자**: 2026-07-14
- **관련**: [0006](0006-backend-spring-plus-python-ai.md)

## 맥락
백엔드는 Spring(Java) 확정([0006](0006-backend-spring-plus-python-ai.md)). 팀 기획서는 **Spring Boot 4.1 + Java 21**을 제안. Java 21(virtual threads)은 쓰고 싶은데, Spring Boot 라인을 최신(4.x)으로 갈지 안정(3.x)으로 갈지 결정 필요.

## 결정
**Java 21 + Spring Boot 3.4/3.5(stable)** 채택. 기획서의 4.1은 **기각**.

## 근거
- Java 21의 이점(**virtual threads**로 blocking I/O 동시성 확대)은 **Spring Boot 3.2+에서 이미 완전 지원** → 4.1을 쓸 실익이 크지 않음.
- Spring Boot 4.x는 Spring Framework 7 기반 최신(2025+)이라 자료·트러블슈팅이 적고 호환 리스크. 부트캠프 팀 러닝커브·안정성 대비 실익 낮음.

## 대안
| 대안 | 장점 | 단점 |
|---|---|---|
| **3.4/3.5 stable (선택)** | Java21+VT 완전 지원, 자료 풍부·안정 | 최신 신기능 일부 없음(불필요) |
| 4.1 (기획서) | 최신 | 자료 적음·삽질 리스크, 실익 낮음 |

## 영향·후속
- 컨트롤 플레인은 **MVC + virtual threads**, 외부 AI/미디어 호출은 WebClient(blocking 동시성). reactive/JPA 혼합 회피.
- 배포 시점 최신 patch 버전 재확인.
