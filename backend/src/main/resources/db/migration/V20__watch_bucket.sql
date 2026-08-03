-- 구간별 시청 횟수. 재생바 위의 "많이 다시 본 구간" 그래프와 학습률이 이 한 표에서 나온다.
--
-- **왜 위치가 아니라 칸인가**: 지금 진도는 "재생 위치 ÷ 전체 길이"라 끝으로 한 번 끌면 100%가 된다.
-- 본 칸 수로 세면 안 본 곳은 안 본 채로 남는다. 그리고 같은 데이터가 재시청 그래프의 원본이 된다 —
-- 한 번 보내서 둘 다 얻는다.
--
-- **칸 길이는 고정(10초)이고 개수는 고정하지 않는다.** 라이브는 강의가 자라는 중이라 전체 길이를
-- 모르는데, 개수를 고정하면 길이가 바뀔 때마다 칸 경계가 흔들려 과거 기록과 어긋난다. 그래프
-- 해상도(약 100점)는 읽을 때 묶어서 맞춘다.
--
-- **축은 세션 상대 ms다.** 라이브 되감기와 종료 후 다시보기가 같은 축을 쓰므로 칸 번호가 그대로
-- 이어진다 — 강사에게는 "라이브에서 되돌린 곳"과 "나중에 다시 본 곳"이 한 그래프에 쌓이는 것이 맞다.
CREATE TABLE core.watch_bucket (
  lesson_id uuid NOT NULL,
  user_id uuid NOT NULL,

  -- floor(sessionMs / bucket_size_ms). 0부터 시작한다.
  bucket_index integer NOT NULL,

  -- 이 칸을 몇 번 재생했는가. 1이면 한 번 봤다, 2 이상이면 다시 봤다.
  play_count integer NOT NULL DEFAULT 1 CHECK (play_count > 0),

  updated_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (lesson_id, user_id, bucket_index)
);

-- 그래프는 레슨 하나의 모든 칸을 훑는다: 칸별 sum(play_count)와 도달자 수(count(user)).
CREATE INDEX idx_watch_bucket_lesson ON core.watch_bucket (lesson_id, bucket_index);

COMMENT ON TABLE core.watch_bucket IS
  '구간별 시청 횟수(세션 상대 ms를 10초 칸으로). 재시청 그래프와 칸 기준 학습률의 원본.';
COMMENT ON COLUMN core.watch_bucket.play_count IS
  '재생 횟수. 2 이상이 재시청이다. 클라이언트가 누적 절대값을 보내고 서버는 큰 쪽을 남긴다(재전송 안전).';
