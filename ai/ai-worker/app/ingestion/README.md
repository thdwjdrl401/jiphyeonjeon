# `ai-worker/app/ingestion`

PPTX bytes를 안전하고 결정적인 page별 chunk로 변환한다.

## 역할

- OOXML ZIP 구조·경로·중복·symlink·암호화·resource limit을 검증한다.
- text frame, table, notes를 안정된 slide 순서로 추출한다.
- slide 경계를 넘지 않는 NFC/공백 정규화 chunk와 hash를 만든다.

## 구조와 흐름

```text
bytes -> ZIP/OOXML preflight -> ParsedPresentation -> MaterialChunk[]
```

## 파일 구성

`pptx_parser.py`, `chunker.py`, `models.py`(`ContentBlock`/`MaterialChunk`/`ParsedPresentation`과
GMS 핵심 용어 추출 결과 모델 `KeyTerm`), 공개 export용 `__init__.py`로 구성된다.

## 경계와 불변식

- archive를 filesystem에 풀거나 외부 relationship를 fetch하지 않는다.
- 서로 다른 slide를 한 chunk로 합치지 않는다.
- 이미지 OCR, SmartArt, chart, grouped shape text는 현재 범위 밖이다.

## 검증

`uv run --frozen pytest -q tests/test_pptx_parser.py tests/test_chunker.py`
