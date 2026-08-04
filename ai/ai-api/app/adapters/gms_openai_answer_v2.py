from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator, Sequence

import httpx
from openai import (
    APIError,
    APIStatusError,
    APITimeoutError,
    AsyncOpenAI,
    AuthenticationError,
    BadRequestError,
    NotFoundError,
    PermissionDeniedError,
    RateLimitError,
)

from app.adapters.gms_openai_answer import (
    GMS_OPENAI_BASE_URL,
    _SYSTEM_PROMPT,
    _close_stream_safely,
    _strip_grounding_tag,
)
from app.rag.errors import RagStreamFailure
from app.rag.models import (
    AnnotationSourceV2,
    CaptionSourceV2,
    PptxSourceV2,
    RagAnswerRequestV2,
    RetrievedEvidenceV2,
)
from app.rag.ports import GroundedCapture

logger = logging.getLogger(__name__)

_MAX_DELTA_CHARS = 10_000


class GmsOpenAIAnswerModelV2:
    """Replay (v2) counterpart of GmsOpenAIAnswerModel.

    HTTP client setup, streaming loop, and error mapping are duplicated (not modified) from
    gms_openai_answer.py — see docs/decisions/jinwoo/0008 for why v1 stays untouched. Only the
    prompt payload differs: it uses PptxSourceV2/CaptionSourceV2 coordinates instead of v1's
    PptxSource/CaptionSource, and never sends `excerpt` (display-only) to the model — the full
    `content` text is sent instead, same as v1.
    """

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        max_output_tokens: int,
        max_prompt_chars: int,
        timeout_seconds: float,
        client: AsyncOpenAI | None = None,
    ) -> None:
        if not api_key or api_key != api_key.strip():
            raise ValueError("GMS API key must be non-empty and unpadded")
        if not model or model != model.strip():
            raise ValueError("GMS model must be non-empty and unpadded")
        if min(max_output_tokens, max_prompt_chars, timeout_seconds) <= 0:
            raise ValueError("GMS output, prompt, and timeout limits must be positive")
        self._model = model
        self._max_output_tokens = max_output_tokens
        self._max_prompt_chars = max_prompt_chars
        self._owns_client = client is None
        self._client = client or AsyncOpenAI(
            api_key=api_key,
            base_url=GMS_OPENAI_BASE_URL,
            timeout=timeout_seconds,
            max_retries=0,
        )

    def stream_answer(
        self,
        request: RagAnswerRequestV2,
        evidence: Sequence[RetrievedEvidenceV2],
        *,
        grounded_capture: GroundedCapture | None = None,
    ) -> AsyncIterator[str]:
        return _strip_grounding_tag(self._stream_answer(request, evidence), grounded_capture)

    async def _stream_answer(
        self,
        request: RagAnswerRequestV2,
        evidence: Sequence[RetrievedEvidenceV2],
    ) -> AsyncIterator[str]:
        stream = None
        try:
            prompt = _prompt_payload_v2(request, evidence)
            if len(prompt) > self._max_prompt_chars:
                raise RagStreamFailure(code="MODEL_CONFIGURATION_ERROR")
            stream = await self._client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=self._max_output_tokens,
                stream=True,
            )
            async for chunk in stream:
                if not chunk.choices:
                    continue
                text = chunk.choices[0].delta.content
                if not text:
                    continue
                for start in range(0, len(text), _MAX_DELTA_CHARS):
                    yield text[start : start + _MAX_DELTA_CHARS]
        except (APITimeoutError, httpx.TimeoutException) as error:
            raise RagStreamFailure(code="MODEL_TIMEOUT") from error
        except httpx.TransportError as error:
            raise RagStreamFailure(code="MODEL_UNAVAILABLE") from error
        except APIError as error:
            raise RagStreamFailure(code=_failure_code(error)) from error
        finally:
            if stream is not None:
                await _close_stream_safely(stream)

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.close()


def _prompt_payload_v2(
    request: RagAnswerRequestV2,
    evidence: Sequence[RetrievedEvidenceV2],
) -> str:
    items: list[dict[str, object]] = []
    for item in evidence:
        if isinstance(item.source, PptxSourceV2):
            source = {"type": "PPTX", "page": item.source.page}
        elif isinstance(item.source, CaptionSourceV2):
            source = {
                "type": "CAPTION",
                "startSessionMs": item.source.startSessionMs,
                "endSessionMs": item.source.endSessionMs,
            }
        elif isinstance(item.source, AnnotationSourceV2):
            # The clock face is what lets the model resolve "아까" by comparing it against
            # askedAt below, instead of guessing from raw milliseconds (ADR-0043 §5-2).
            source = {
                "type": "ANNOTATION",
                "highlightedAt": _clock(item.source.sessionMs),
                "sessionMs": item.source.sessionMs,
            }
        else:  # pragma: no cover - AnswerSourceV2 is a closed discriminated union
            raise TypeError("unsupported evidence source")
        items.append({"source": source, "content": item.content})
    return json.dumps(
        {
            "question": request.question,
            "askedAt": _clock(request.context.questionSessionMs),
            "evidence": items,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )


def _clock(session_ms: int) -> str:
    """Session-relative milliseconds as mm:ss, or h:mm:ss once past an hour."""

    total_minutes, seconds = divmod(max(0, session_ms) // 1_000, 60)
    hours, minutes = divmod(total_minutes, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{seconds:02d}"
    return f"{minutes:02d}:{seconds:02d}"


def _failure_code(error: APIError) -> str:
    if isinstance(error, RateLimitError):
        return "MODEL_RATE_LIMITED"
    if isinstance(error, (AuthenticationError, PermissionDeniedError)):
        return "MODEL_AUTH_FAILED"
    if isinstance(error, (BadRequestError, NotFoundError)):
        return "MODEL_CONFIGURATION_ERROR"
    if isinstance(error, APIStatusError):
        if error.status_code == 408:
            return "MODEL_TIMEOUT"
        if error.status_code == 409 or error.status_code >= 500:
            return "MODEL_UNAVAILABLE"
        return "MODEL_CONFIGURATION_ERROR"
    return "MODEL_UNAVAILABLE"
