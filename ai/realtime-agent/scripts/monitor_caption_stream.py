from __future__ import annotations

import argparse
import asyncio
import json
import os

from redis.asyncio import Redis


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Replay caption entries and keep following a Redis Stream."
    )
    parser.add_argument("--session-id", required=True, help="Only show one LiveClass session.")
    parser.add_argument("--from-id", default="0-0", help="Redis entry ID; default replays all.")
    parser.add_argument("--raw", action="store_true", help="Print one JSON object per entry.")
    parser.add_argument("--redis-url", default=os.getenv("REDIS_URL", ""))
    parser.add_argument("--redis-username", default=os.getenv("REDIS_USERNAME", ""))
    parser.add_argument("--redis-password", default=os.getenv("REDIS_PASSWORD", ""))
    parser.add_argument("--stream-key", default=os.getenv("CAPTION_STREAM_KEY", "ai:captions:live"))
    return parser.parse_args(argv)


def format_entry(entry_id: str, values: dict[str, str], *, raw: bool) -> str | None:
    if raw:
        return json.dumps({"redisId": entry_id, **values}, ensure_ascii=False)
    if values.get("type") == "caption.delta":
        return values.get("delta", "")
    if values.get("type") == "caption.stream.completed":
        return (
            "\n\n[completed "
            f"session={values.get('sessionId')} sequence={values.get('lastSequence')} "
            f"reason={values.get('reason')}]"
        )
    return None


async def monitor(
    redis: Redis,
    stream_key: str,
    *,
    session_id: str,
    from_id: str,
    raw: bool,
) -> None:
    cursor = from_id
    print(f"monitoring stream={stream_key} session={session_id} from={from_id}", flush=True)
    while True:
        try:
            batches = await redis.xread({stream_key: cursor}, count=200, block=5_000)
        except UnicodeDecodeError as exc:
            raise RuntimeError("caption stream contains invalid UTF-8") from exc
        for _stream, entries in batches:
            for entry_id, values in entries:
                cursor = entry_id
                if values.get("sessionId") != session_id:
                    continue
                output = format_entry(entry_id, values, raw=raw)
                if output is not None:
                    print(output, end="\n" if raw else "", flush=True)


async def main() -> None:
    args = parse_args()
    if not args.redis_url.strip():
        raise RuntimeError("missing required setting: REDIS_URL or --redis-url")
    if not args.stream_key.strip():
        raise RuntimeError("stream key must not be blank")
    redis = Redis.from_url(
        args.redis_url,
        username=args.redis_username or None,
        password=args.redis_password or None,
        decode_responses=True,
        encoding_errors="strict",
    )
    try:
        await monitor(
            redis,
            args.stream_key,
            session_id=args.session_id,
            from_id=args.from_id,
            raw=args.raw,
        )
    finally:
        await redis.aclose()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nmonitor stopped")
