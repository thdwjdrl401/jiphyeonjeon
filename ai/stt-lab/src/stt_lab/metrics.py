from __future__ import annotations

import re
import unicodedata
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from stt_lab.transcriptions import (
    TranscriptionSegment,
    canonical_transcription,
    parse_aihub_transcription,
    transcription_alternative_count,
)

_NUMBER = re.compile(r"[+-]?\d+(?:[.,]\d+)?")


@dataclass(frozen=True)
class TranscriptMetrics:
    raw_cer: float
    normalized_cer: float
    literal_normalized_cer: float
    reference_alternative_count: int
    term_recall: float | None
    number_exact_match: float | None
    normalized_reference: str
    normalized_hypothesis: str


def evaluate_transcript(
    reference: str,
    hypothesis: str,
    terms: Sequence[str] = (),
    *,
    training_reference: str | None = None,
) -> TranscriptMetrics:
    reference_segments = parse_aihub_transcription(reference)
    written_reference = training_reference or canonical_transcription(reference)
    normalized_reference = normalize_korean_text(written_reference)
    normalized_hypothesis = normalize_korean_text(hypothesis)
    return TranscriptMetrics(
        raw_cer=_multi_reference_error_rate(
            reference_segments,
            hypothesis,
            transform=tuple,
        ),
        normalized_cer=_multi_reference_error_rate(
            reference_segments,
            hypothesis,
            transform=lambda value: tuple(normalize_korean_text(value).replace(" ", "")),
        ),
        literal_normalized_cer=_error_rate(
            tuple(normalize_korean_text(reference).replace(" ", "")),
            tuple(normalized_hypothesis.replace(" ", "")),
        ),
        reference_alternative_count=transcription_alternative_count(reference),
        term_recall=_term_recall(terms, normalized_hypothesis),
        number_exact_match=_number_exact_match(reference_segments, hypothesis),
        normalized_reference=normalized_reference,
        normalized_hypothesis=normalized_hypothesis,
    )


def normalize_korean_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    characters = [
        character
        if character.isspace() or unicodedata.category(character)[0] in {"L", "N"}
        else " "
        for character in normalized
    ]
    return " ".join("".join(characters).split())


def orthographic_training_reference(value: str) -> str:
    return canonical_transcription(value)


def _error_rate[T](reference: Sequence[T], hypothesis: Sequence[T]) -> float:
    if not reference:
        return 0.0 if not hypothesis else 1.0
    previous = list(range(len(hypothesis) + 1))
    for reference_item in reference:
        previous = _advance_error_row(previous, (reference_item,), hypothesis)
    return previous[-1] / len(reference)


def _multi_reference_error_rate[T](
    reference_segments: Sequence[TranscriptionSegment],
    hypothesis: str,
    *,
    transform: Callable[[str], Sequence[T]],
) -> float:
    hypothesis_items = tuple(transform(hypothesis))
    previous = list(range(len(hypothesis_items) + 1))
    canonical_length = 0
    for segment in reference_segments:
        alternatives = tuple(tuple(transform(value)) for value in segment.alternatives)
        canonical_length += len(alternatives[0])
        advanced = [
            _advance_error_row(previous, alternative, hypothesis_items)
            for alternative in alternatives
        ]
        previous = [min(rows) for rows in zip(*advanced, strict=True)]

    if canonical_length == 0:
        return 0.0 if previous[-1] == 0 else 1.0
    return previous[-1] / canonical_length


def _advance_error_row[T](
    initial: Sequence[int],
    reference: Sequence[T],
    hypothesis: Sequence[T],
) -> list[int]:
    previous = list(initial)
    for reference_item in reference:
        current = [previous[0] + 1]
        for index, hypothesis_item in enumerate(hypothesis, start=1):
            current.append(
                min(
                    current[index - 1] + 1,
                    previous[index] + 1,
                    previous[index - 1] + (reference_item != hypothesis_item),
                )
            )
        previous = current
    return previous


def _term_recall(terms: Sequence[str], normalized_hypothesis: str) -> float | None:
    if not terms:
        return None
    hits = sum(normalize_korean_text(term) in normalized_hypothesis for term in terms)
    return hits / len(terms)


def _number_exact_match(
    reference_segments: Sequence[TranscriptionSegment],
    hypothesis: str,
) -> float | None:
    actual = tuple(_NUMBER.findall(unicodedata.normalize("NFKC", hypothesis)))
    if not any(
        _NUMBER.search(unicodedata.normalize("NFKC", alternative))
        for segment in reference_segments
        for alternative in segment.alternatives
    ):
        return None

    reachable = {0}
    for segment in reference_segments:
        next_reachable: set[int] = set()
        for alternative in segment.alternatives:
            expected = tuple(_NUMBER.findall(unicodedata.normalize("NFKC", alternative)))
            for offset in reachable:
                if actual[offset : offset + len(expected)] == expected:
                    next_reachable.add(offset + len(expected))
        reachable = next_reachable
    return float(len(actual) in reachable)
