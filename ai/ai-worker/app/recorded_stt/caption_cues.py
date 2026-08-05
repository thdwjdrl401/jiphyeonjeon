from __future__ import annotations

import re
from dataclasses import dataclass

from app.recorded_stt.openai_whisper import WhisperSegment, WhisperWord
from app.recorded_stt.transcription_normalizer import NormalizedTranscription

_TERMINAL_PUNCTUATION = re.compile(r"[.!?。！？…][\"'”’)\]}]*$")
_ATTACHED_PUNCTUATION = frozenset(",.:;!?、。，！？…)]}〉》」』”’")


@dataclass(frozen=True, slots=True)
class CaptionCue:
    start_seconds: float
    end_seconds: float
    text: str


@dataclass(frozen=True, slots=True)
class CaptionCueAssembler:
    max_duration_ms: int = 6_000
    max_chars: int = 42
    pause_break_ms: int = 500

    def assemble_transcription(
        self,
        transcription: NormalizedTranscription,
    ) -> tuple[CaptionCue, ...]:
        if not transcription.segments:
            return self.assemble(transcription.words)

        cues: list[CaptionCue] = []
        covered_word_indexes: set[int] = set()
        for segment in transcription.segments:
            indexed_words = tuple(
                (index, word)
                for index, word in enumerate(transcription.words)
                if index not in covered_word_indexes and self._inside(segment, word)
            )
            covered_word_indexes.update(index for index, _word in indexed_words)
            cues.extend(self._assemble_segment(segment, tuple(word for _index, word in indexed_words)))

        uncovered_words = tuple(
            word
            for index, word in enumerate(transcription.words)
            if index not in covered_word_indexes
        )
        cues.extend(self.assemble(uncovered_words))
        return tuple(sorted(cues, key=lambda cue: (cue.start_seconds, cue.end_seconds)))

    def assemble(self, words: tuple[WhisperWord, ...]) -> tuple[CaptionCue, ...]:
        cues: list[CaptionCue] = []
        cue_words: list[WhisperWord] = []
        cue_text = ""

        for word in words:
            token = word.word.strip()
            if not token:
                continue
            candidate_text = self._append(cue_text, word.word)
            should_break_before = bool(cue_words) and (
                round((word.start - cue_words[-1].end) * 1000) >= self.pause_break_ms
                or round((word.end - cue_words[0].start) * 1000) > self.max_duration_ms
                or len(candidate_text) > self.max_chars
            )
            if should_break_before:
                cues.append(self._cue(cue_words, cue_text))
                cue_words = []
                cue_text = ""
                candidate_text = self._append(cue_text, word.word)

            cue_words.append(word)
            cue_text = candidate_text
            if _TERMINAL_PUNCTUATION.search(cue_text):
                cues.append(self._cue(cue_words, cue_text))
                cue_words = []
                cue_text = ""

        if cue_words:
            cues.append(self._cue(cue_words, cue_text))
        return tuple(cues)

    def _assemble_segment(
        self,
        segment: WhisperSegment,
        words: tuple[WhisperWord, ...],
    ) -> tuple[CaptionCue, ...]:
        text = segment.text.strip()
        duration_ms = round((segment.end - segment.start) * 1000)
        if duration_ms <= self.max_duration_ms and len(text) <= self.max_chars:
            return (CaptionCue(segment.start, segment.end, text),)
        aligned_words = self._align_segment_text(text, words)
        if aligned_words is None:
            return (CaptionCue(segment.start, segment.end, text),)
        return self.assemble(aligned_words)

    @staticmethod
    def _inside(segment: WhisperSegment, word: WhisperWord) -> bool:
        midpoint = (word.start + word.end) / 2
        return segment.start <= midpoint <= segment.end

    @staticmethod
    def _align_segment_text(
        segment_text: str,
        words: tuple[WhisperWord, ...],
    ) -> tuple[WhisperWord, ...] | None:
        if not words:
            return None
        positions: list[tuple[int, int]] = []
        cursor = 0
        for word in words:
            token = word.word.strip()
            start = segment_text.find(token, cursor)
            if start < 0:
                return None
            end = start + len(token)
            positions.append((start, end))
            cursor = end

        aligned: list[WhisperWord] = []
        for index, word in enumerate(words):
            span_start = 0 if index == 0 else positions[index][0]
            span_end = positions[index + 1][0] if index + 1 < len(words) else len(segment_text)
            display_text = segment_text[span_start:span_end].strip()
            if not display_text:
                return None
            aligned.append(word.model_copy(update={"word": display_text}))
        return tuple(aligned)

    @staticmethod
    def _append(current: str, raw_token: str) -> str:
        token = raw_token.strip()
        if not current:
            return token
        if token[:1] in _ATTACHED_PUNCTUATION:
            return f"{current}{token}"
        return f"{current} {token}"

    @staticmethod
    def _cue(words: list[WhisperWord], text: str) -> CaptionCue:
        return CaptionCue(
            start_seconds=words[0].start,
            end_seconds=words[-1].end,
            text=text,
        )
