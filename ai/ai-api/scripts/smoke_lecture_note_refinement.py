from __future__ import annotations

import asyncio

from app.adapters.gms_openai_lecture_note import GmsOpenAILectureNoteModel
from app.config import load_settings
from app.lecture_notes import (
    LectureNote,
    LectureNoteRefinementRequest,
    LectureNoteTopic,
)


async def _main() -> None:
    settings = load_settings()
    if settings.gms_api_key is None:
        raise ValueError("AI_API_GMS_API_KEY is required")
    model = GmsOpenAILectureNoteModel(
        api_key=settings.gms_api_key.get_secret_value(),
        model=settings.lecture_note_model or settings.gms_model,
        max_output_tokens=settings.lecture_note_max_output_tokens,
        max_prompt_chars=settings.lecture_note_max_prompt_chars,
        timeout_seconds=settings.lecture_note_timeout_seconds,
        refinement_max_output_tokens=settings.lecture_note_refinement_max_output_tokens,
        refinement_max_prompt_chars=settings.lecture_note_refinement_max_prompt_chars,
        refinement_timeout_seconds=settings.lecture_note_refinement_timeout_seconds,
    )
    request = LectureNoteRefinementRequest(
        session_id="11111111-1111-4111-8111-111111111111",
        lesson_id="22222222-2222-4222-8222-222222222222",
        note=LectureNote(
            topics=(
                LectureNoteTopic(
                    topic_id="topic-1",
                    title="ACK 처리",
                    key_points=("DB 저장 뒤 ACK한다.",),
                ),
                LectureNoteTopic(
                    topic_id="topic-2",
                    title="ACK 주의사항",
                    key_points=("DB 저장 전 ACK하면 메시지를 잃을 수 있다.",),
                ),
            ),
            chunk_sequence=2,
        ),
    )
    try:
        result = await model.refine(request)
        print(result.model_dump_json(indent=2))
    finally:
        await model.aclose()


if __name__ == "__main__":
    asyncio.run(_main())
