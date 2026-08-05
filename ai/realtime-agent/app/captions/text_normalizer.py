from __future__ import annotations

import re
import unicodedata

_LAUGHTER_JAMO = frozenset({"ㅋ", "ㅎ", "ᄏ", "ᄒ"})
_EXTRA_DASHES = frozenset({"\u00ad", "−", "﹣", "－"})
_NO_SPACE_BEFORE = frozenset(",.!?…:;)]}〉》」』】")
_LAUGHTER_MARKER = re.compile(r"[\(\[\{<（［｛〈《「『【]\s*웃음\s*[\)\]\}>）］｝〉》」』】]")


def _is_separator(character: str) -> bool:
    return (
        character.isspace()
        or character in _LAUGHTER_JAMO
        or character in _EXTRA_DASHES
        or unicodedata.category(character) == "Pd"
    )


class CaptionTextNormalizer:
    """Remove display noise while preserving append-only delta boundaries."""

    def __init__(self) -> None:
        self._pending_separator = False
        self._segment_parts: list[str] = []

    @property
    def current_text(self) -> str:
        return "".join(self._segment_parts)

    def normalize_delta(self, text: str) -> str:
        if not isinstance(text, str):
            raise TypeError("caption text must be a string")
        output: list[str] = []
        for character in _LAUGHTER_MARKER.sub(" ", text):
            if _is_separator(character):
                if self._segment_parts or output:
                    self._pending_separator = True
                continue
            if self._pending_separator:
                if character not in _NO_SPACE_BEFORE:
                    output.append(" ")
                self._pending_separator = False
            output.append(character)
        fragment = "".join(output)
        if fragment:
            self._segment_parts.append(fragment)
        return fragment

    def normalize_final(self, text: str) -> str:
        normalizer = CaptionTextNormalizer()
        return normalizer.normalize_delta(text).strip()

    def reset_segment(self) -> None:
        self._pending_separator = False
        self._segment_parts.clear()
