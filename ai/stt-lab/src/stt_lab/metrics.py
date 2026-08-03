from __future__ import annotations

import re
import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass

_NUMBER = re.compile(r"[+-]?\d+(?:[.,]\d+)?")


@dataclass(frozen=True)
class TranscriptMetrics:
    raw_cer: float
    normalized_cer: float
    term_recall: float | None
    number_exact_match: float | None
    normalized_reference: str
    normalized_hypothesis: str


def evaluate_transcript(
    reference: str,
    hypothesis: str,
    terms: Sequence[str] = (),
) -> TranscriptMetrics:
    normalized_reference = normalize_korean_text(reference)
    normalized_hypothesis = normalize_korean_text(hypothesis)
    return TranscriptMetrics(
        raw_cer=_error_rate(tuple(reference), tuple(hypothesis)),
        normalized_cer=_error_rate(
            tuple(normalized_reference.replace(" ", "")),
            tuple(normalized_hypothesis.replace(" ", "")),
        ),
        term_recall=_term_recall(terms, normalized_hypothesis),
        number_exact_match=_number_exact_match(reference, hypothesis),
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


def _error_rate[T](reference: Sequence[T], hypothesis: Sequence[T]) -> float:
    if not reference:
        return 0.0 if not hypothesis else 1.0
    previous = list(range(len(hypothesis) + 1))
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
    return previous[-1] / len(reference)


def _term_recall(terms: Sequence[str], normalized_hypothesis: str) -> float | None:
    if not terms:
        return None
    hits = sum(normalize_korean_text(term) in normalized_hypothesis for term in terms)
    return hits / len(terms)


def _number_exact_match(reference: str, hypothesis: str) -> float | None:
    expected = _NUMBER.findall(unicodedata.normalize("NFKC", reference))
    if not expected:
        return None
    actual = _NUMBER.findall(unicodedata.normalize("NFKC", hypothesis))
    return float(expected == actual)
