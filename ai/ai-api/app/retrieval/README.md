# `ai-api/app/retrieval`

질문 embedding을 검증하고 curriculum 범위의 ACTIVE material chunk 검색을 호출하는 application
service다(ADR-0005: 같은 curriculum 내 lesson들이 PPTX 자료를 공유한다).

## 흐름

```text
question -> QueryEmbeddingPort -> 1024차원 finite/non-zero 재정규화
         -> ActiveMaterialSearchPort(curriculumId, query text, vector, topK)
         -> ordered MaterialChunkHit
```

모델명·revision과 HTTP 오류는 BGE adapter 책임이며, 실제 SQL과 DB role은 pgvector adapter 책임이다.
이 계층은 query whitespace를 경계에서 정규화하고 `topK`를 1~50으로 제한한다.
