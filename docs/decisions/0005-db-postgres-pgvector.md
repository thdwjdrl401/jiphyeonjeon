# ADR-0005: DB = PostgreSQL + pgvector (MySQL 대체)

> 📍 하네스 개요: [../harness/README.md](../harness/README.md) · 아키텍처: [../ARCHITECTURE.md](../ARCHITECTURE.md)

- **상태**: 채택
- **일자**: 2026-07-14
- **관련**: [0003](0003-greenfield-redesign.md), [0007](0007-domain-live-session.md)

## 맥락
RAG(자료·자막 근거 검색)가 제품 핵심이라 **벡터 유사도 검색**이 필요하다. 공식 스켈레톤은 MySQL 8이지만 MySQL 8엔 네이티브 벡터 타입이 없다.

## 결정
DB를 **PostgreSQL + pgvector**로 한다. 관계형 데이터와 벡터 임베딩을 **한 DB**에서 다룬다.

## 근거
- 관계형 + 벡터를 한 저장소로 → 운영·정합성 단순.
- pgvector는 RAG 제품의 사실상 표준.

## 대안
| 대안 | 장점 | 단점 |
|---|---|---|
| **Postgres + pgvector (선택)** | 단일 DB, RAG 정석 | 팀 MySQL 친숙도 포기 |
| MySQL + 벡터DB(Qdrant/Chroma) | MySQL 친숙 유지 | 저장소 2개 운영·정합성 |
| MySQL 단독 | 가장 친숙 | 벡터검색 불가 → RAG 막힘 |

## 영향·후속
- 스키마·JPA/Hibernate를 Postgres 기준으로.
- 임베딩 컬럼은 pgvector 타입. 자료 청크·자막 임베딩 인덱싱.
