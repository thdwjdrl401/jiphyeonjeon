from __future__ import annotations

import re
import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass

_NUMBER = re.compile(r"[+-]?\d+(?:[.,]\d+)?")
_DUAL_TRANSCRIPTION = re.compile(
    r"(?:\(+([^()]*)\)|(?<![\w])([A-Za-z0-9][A-Za-z0-9_-]*))"
    r"\)*\s*/\s*\(([^()]*)\)"
)
_UNRESOLVED_DUAL_TRANSCRIPTION = re.compile(r"\)\s*/\s*\(")


@dataclass(frozen=True)
class TranscriptMetrics:
    raw_cer: float
    normalized_cer: float
    literal_normalized_cer: float
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
    canonical_reference = training_reference or orthographic_training_reference(reference)
    normalized_reference = normalize_korean_text(canonical_reference)
    literal_normalized_reference = normalize_korean_text(reference)
    normalized_hypothesis = normalize_korean_text(hypothesis)
    hypothesis_characters = tuple(normalized_hypothesis.replace(" ", ""))
    return TranscriptMetrics(
        raw_cer=_error_rate(tuple(reference), tuple(hypothesis)),
        normalized_cer=_alternative_aware_cer(
            reference,
            hypothesis_characters,
            denominator_reference=normalized_reference,
        ),
        literal_normalized_cer=_error_rate(
            tuple(literal_normalized_reference.replace(" ", "")),
            hypothesis_characters,
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


def orthographic_training_reference(reference: str) -> str:
    """Choose the left, spelling-form transcript from AI Hub dual notation."""

    return _DUAL_TRANSCRIPTION.sub(_spelling_form, reference)


def has_unresolved_dual_transcription(value: str) -> bool:
    return _UNRESOLVED_DUAL_TRANSCRIPTION.search(value) is not None


def _spelling_form(match: re.Match[str]) -> str:
    return match.group(1) if match.group(1) is not None else match.group(2)


def _alternative_aware_cer(
    reference: str,
    hypothesis: Sequence[str],
    *,
    denominator_reference: str,
) -> float:
    """Score the best path through independent per-occurrence alternatives.

    Merging Levenshtein rows after every alternative computes the exact minimum
    edit distance without expanding up to 2**N complete reference strings. The
    denominator stays fixed to the spelling-form training target.
    """

    row = list(range(len(hypothesis) + 1))
    cursor = 0
    for match in _DUAL_TRANSCRIPTION.finditer(reference):
        row = _advance_reference(
            row,
            _normalized_characters(reference[cursor : match.start()]),
            hypothesis,
        )
        alternatives = tuple(dict.fromkeys((_spelling_form(match), match.group(3))))
        alternative_rows = [
            _advance_reference(row, _normalized_characters(alternative), hypothesis)
            for alternative in alternatives
        ]
        row = [min(values) for values in zip(*alternative_rows, strict=True)]
        cursor = match.end()
    row = _advance_reference(row, _normalized_characters(reference[cursor:]), hypothesis)

    denominator = len(normalize_korean_text(denominator_reference).replace(" ", ""))
    if denominator == 0:
        return 0.0 if not hypothesis else 1.0
    return row[-1] / denominator


def _normalized_characters(value: str) -> tuple[str, ...]:
    return tuple(normalize_korean_text(value).replace(" ", ""))


def _advance_reference(
    previous: Sequence[int],
    reference: Sequence[str],
    hypothesis: Sequence[str],
) -> list[int]:
    row = list(previous)
    for reference_item in reference:
        current = [row[0] + 1]
        for index, hypothesis_item in enumerate(hypothesis, start=1):
            current.append(
                min(
                    current[index - 1] + 1,
                    row[index] + 1,
                    row[index - 1] + (reference_item != hypothesis_item),
                )
            )
        row = current
    return row


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
