# media-worker

ADR-0008의 MP4 → HLS 변환 전용 worker다. `media.transcode` 큐만 소비하며 AI worker와 큐·재시도·배포를
공유하지 않는다.

필수 런타임은 Python 3.12, FFmpeg/ffprobe, RabbitMQ, MinIO/S3다. 환경변수는 `.env.example`을 따른다.
원본 MP4는 작업 직전에 Spring의 내부 API로 presigned GET URL을 받아 내려받고, HLS는
`recorded/{recordedVideoId}/` 아래에 올린다. `index.m3u8`을 마지막에 업로드한 뒤 Spring callback으로
`READY`를 확정한다.
