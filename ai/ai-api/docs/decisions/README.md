# `ai-api/docs/decisions`

`ai-api` 내부 구조·안전 경계에 한정된 ADR을 번호 순서대로 기록한다. Spring이 채택해야 하는 wire 계약은
후보 상태로만 남기고 공유 계약으로 표현하지 않는다.

| ADR | 결정 |
|---|---|
| [0001](0001-rag-answer-core-boundary.md) | port 기반 RAG SSE 수직 코어와 fail-closed 인증 seam |
| [0002](0002-rag-context-runtime-boundary.md) | attempt-aware caption과 query-only pgvector/BGE context adapter |
| [0003](0003-rag-gms-runtime-lifecycle.md) | grounded GMS stream, request registry와 process lifecycle |
