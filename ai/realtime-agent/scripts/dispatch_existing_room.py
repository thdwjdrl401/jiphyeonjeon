from __future__ import annotations

import argparse
import asyncio
import os

from app.connections import LiveKitConnectionSettings, create_livekit_api_client
from app.livekit.manual_dispatch import ManualDispatchRequest, create_verified_dispatch


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create one explicit STT dispatch after verifying an existing room."
    )
    parser.add_argument("--room", required=True)
    parser.add_argument("--instructor", required=True)
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--lesson-id", required=True)
    parser.add_argument("--correlation-id", required=True)
    parser.add_argument(
        "--agent-name", default=os.getenv("STT_AGENT_NAME", "liveclass-realtime-stt")
    )
    return parser.parse_args(argv)


async def run(args: argparse.Namespace) -> None:
    client = create_livekit_api_client(LiveKitConnectionSettings.from_env())
    try:
        dispatch, created = await create_verified_dispatch(
            client.room,
            client.agent_dispatch,
            ManualDispatchRequest(
                room_name=args.room,
                agent_name=args.agent_name,
                session_id=args.session_id,
                lesson_id=args.lesson_id,
                instructor_identity=args.instructor,
                correlation_id=args.correlation_id,
            ),
        )
    finally:
        await client.aclose()
    action = "created" if created else "reused"
    print(f"dispatch {action}: id={dispatch.id} room={dispatch.room} agent={dispatch.agent_name}")


if __name__ == "__main__":
    asyncio.run(run(parse_args()))
