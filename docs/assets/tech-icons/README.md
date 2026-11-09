# 기술 스택 아이콘

발표 자료·문서에 쓰는 **브랜드 컬러** 아이콘 모음. 512×512 투명 배경 PNG와 원본 SVG.

```
svg/   43개  브랜드 컬러 원본 (fetch-icons.sh 40개 + 직접 그린 client·instructor·student 3개)
png/   43개  512×512, 투명 배경
```

## 다이어그램용 아이콘과 다르다

`docs/architecture/infrastructure-diagram/icons/` 에도 아이콘이 있지만 **섞어 쓰면 안 된다.**

| | 이 디렉토리 | infrastructure-diagram |
|---|---|---|
| 색 | 브랜드 컬러 | **흑백**(fill 없음) |
| 용도 | 발표·문서 | 인프라 다이어그램 |
| 소비자 | 사람 | `build_infrastructure_official.py` |

다이어그램 빌드 스크립트는 SVG에 색이 없다는 전제로 자기 팔레트를 입힌다. 그쪽에 컬러 SVG를 넣으면
다이어그램이 깨진다. 그래서 같은 아이콘이 두 벌 존재한다.

## 다시 만들기

```sh
npm install sharp          # 이 디렉토리 안에서 (node_modules는 커밋하지 않는다)
bash fetch-icons.sh
```

크기를 바꾸려면 `ICON_SIZE=1024 bash fetch-icons.sh`.

## 출처와 라이선스

- **Simple Icons** (39개) — 아이콘 데이터는 CC0-1.0. 다만 **상표권은 각 브랜드 소유**다.
  브랜드 가이드라인을 벗어난 사용(임의 재배색, 변형, 후원·제휴 암시)은 라이선스와 별개 문제이니
  대외 배포 전에 확인한다.
- **amazon-ec2** — AWS Architecture Icons 원본. Simple Icons가 상표 요청으로 AWS 마크를 내려서
  `infrastructure-diagram/icons/official/aws/` 의 공식 파일을 복사해 쓴다.

## livekit은 두 벌이다

LiveKit 브랜드 마크는 **순백(#FFFFFF)** 이라 흰 배경에서 보이지 않는다.

- `livekit.png` — 원본 흰색. 어두운 배경용
- `livekit-on-light.png` — `#1F2328`로 바꾼 것. 밝은 배경용

`huggingface`(#FFD21E)도 밝지만 노란 얼굴 자체가 브랜드라 그대로 둔다.

## 공식 마크가 없어 빠진 것

스택에는 있지만 배포 가능한 브랜드 마크가 없다. 필요하면 텍스트나 직접 만든 도형으로 표기한다.

| | 비고 |
|---|---|
| OpenAI | Simple Icons가 상표 요청으로 내렸다. 공식 배포 마크 없음 |
| pgvector | 로고 없음 — `postgresql`로 대신한다 |
| coturn | 로고 없음 |
| MathJax · hls.js · STOMP | 로고 없음 |
| Vidstack · BouncyCastle · web-push | 로고 없음 |
| certbot | `letsencrypt`로 대신한다 |
| Spring Modulith | `springboot`로 대신한다 |
