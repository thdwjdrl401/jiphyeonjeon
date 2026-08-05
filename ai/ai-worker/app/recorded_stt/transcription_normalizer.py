from __future__ import annotations

import math
from dataclasses import dataclass

from app.recorded_stt.openai_whisper import (
    WhisperResult,
    WhisperSegment,
    WhisperTranscriptionError,
    WhisperWord,
)

_BOUNDARY_TOLERANCE_SECONDS = 2.0
_SAME_BOUNDARY_EPSILON_SECONDS = 0.001
_ATTACHED_PUNCTUATION = frozenset(",.:;!?、。，！？…)]}〉》」』”’")


@dataclass(frozen=True, slots=True)
class TranscriptionNormalizationStats:
    raw_segment_count: int
    raw_word_count: int
    invalid_segment_count: int
    zero_duration_word_count: int
    merged_word_count: int
    discarded_word_count: int
    fallback_mode: str


@dataclass(frozen=True, slots=True)
class NormalizedTranscription:
    duration: float
    text: str
    segments: tuple[WhisperSegment, ...]
    words: tuple[WhisperWord, ...]
    stats: TranscriptionNormalizationStats


def normalize_transcription(result: WhisperResult) -> NormalizedTranscription:
    segments, invalid_segment_count = _normalize_segments(result)
    words, zero_count, merged_count, discarded_count = _normalize_words(
        result,
        has_segments=bool(segments),
    )
    if segments:
        fallback_mode = "SEGMENT_PRIMARY"
    elif words:
        fallback_mode = "WORD_ONLY"
    elif not result.text.strip() and not result.segments and not result.words:
        fallback_mode = "EMPTY"
    else:
        reason = "TIMESTAMPS_MISSING" if result.text.strip() else "TIMESTAMPS_INVALID"
        raise WhisperTranscriptionError(
            "OpenAI transcript did not contain usable timestamps",
            code="STT_RESPONSE_INVALID",
            retryable=False,
            reason=reason,
        )
    return NormalizedTranscription(
        duration=result.duration,
        text=result.text,
        segments=segments,
        words=words,
        stats=TranscriptionNormalizationStats(
            raw_segment_count=len(result.segments),
            raw_word_count=len(result.words),
            invalid_segment_count=invalid_segment_count,
            zero_duration_word_count=zero_count,
            merged_word_count=merged_count,
            discarded_word_count=discarded_count,
            fallback_mode=fallback_mode,
        ),
    )


def _normalize_segments(result: WhisperResult) -> tuple[tuple[WhisperSegment, ...], int]:
    accepted: list[WhisperSegment] = []
    invalid_count = 0
    previous_start = -1.0
    for segment in result.segments:
        if (
            not _finite_pair(segment.start, segment.end)
            or segment.start < 0
            or segment.end <= segment.start
            or segment.end > result.duration + _BOUNDARY_TOLERANCE_SECONDS
            or not segment.text.strip()
            or segment.start < previous_start
        ):
            invalid_count += 1
            continue
        accepted.append(segment.model_copy(update={"text": segment.text.strip()}))
        previous_start = segment.start
    return tuple(accepted), invalid_count


def _normalize_words(
    result: WhisperResult,
    *,
    has_segments: bool,
) -> tuple[tuple[WhisperWord, ...], int, int, int]:
    candidates: list[WhisperWord] = []
    discarded_count = 0
    previous_start = -1.0
    for word in result.words:
        if (
            not _finite_pair(word.start, word.end)
            or word.start < 0
            or word.end < word.start
            or word.end > result.duration + _BOUNDARY_TOLERANCE_SECONDS
            or not word.word.strip()
            or word.start < previous_start
        ):
            discarded_count += 1
            continue
        candidates.append(word.model_copy(update={"word": word.word.strip()}))
        previous_start = word.start

    positive_positions = [
        position for position, word in enumerate(candidates) if word.end > word.start
    ]
    prefix_tokens: dict[int, list[str]] = {}
    suffix_tokens: dict[int, list[str]] = {}
    zero_count = 0
    merged_count = 0
    for position, word in enumerate(candidates):
        if word.end > word.start:
            continue
        zero_count += 1
        previous_position = _previous_position(positive_positions, position)
        next_position = _next_position(positive_positions, position)
        if next_position is not None and _same_boundary(
            word.start, candidates[next_position].start
        ):
            prefix_tokens.setdefault(next_position, []).append(word.word)
            merged_count += 1
        elif previous_position is not None and _same_boundary(
            word.start, candidates[previous_position].end
        ):
            suffix_tokens.setdefault(previous_position, []).append(word.word)
            merged_count += 1
        elif has_segments:
            discarded_count += 1
        elif previous_position is None and next_position is not None:
            prefix_tokens.setdefault(next_position, []).append(word.word)
            merged_count += 1
        elif next_position is None and previous_position is not None:
            suffix_tokens.setdefault(previous_position, []).append(word.word)
            merged_count += 1
        elif previous_position is not None and next_position is not None:
            previous_distance = abs(word.start - candidates[previous_position].end)
            next_distance = abs(candidates[next_position].start - word.start)
            if next_distance <= previous_distance:
                prefix_tokens.setdefault(next_position, []).append(word.word)
            else:
                suffix_tokens.setdefault(previous_position, []).append(word.word)
            merged_count += 1
        else:
            discarded_count += 1

    normalized: list[WhisperWord] = []
    for position in positive_positions:
        word = candidates[position]
        text = _join_tokens(
            (*prefix_tokens.get(position, ()), word.word, *suffix_tokens.get(position, ()))
        )
        normalized.append(word.model_copy(update={"word": text}))
    return tuple(normalized), zero_count, merged_count, discarded_count


def _previous_position(positions: list[int], current: int) -> int | None:
    return next((position for position in reversed(positions) if position < current), None)


def _next_position(positions: list[int], current: int) -> int | None:
    return next((position for position in positions if position > current), None)


def _same_boundary(left: float, right: float) -> bool:
    return abs(left - right) <= _SAME_BOUNDARY_EPSILON_SECONDS


def _finite_pair(start: float, end: float) -> bool:
    return math.isfinite(start) and math.isfinite(end)


def _join_tokens(tokens: tuple[str, ...]) -> str:
    result = ""
    for raw_token in tokens:
        token = raw_token.strip()
        if not result:
            result = token
        elif token[:1] in _ATTACHED_PUNCTUATION:
            result = f"{result}{token}"
        else:
            result = f"{result} {token}"
    return result
