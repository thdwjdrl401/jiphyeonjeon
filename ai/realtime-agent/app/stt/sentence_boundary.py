from __future__ import annotations

_TERMINALS = frozenset(".?!")
_CLOSERS = frozenset("\"'’”)]")


def split_sentences(text: str) -> list[str]:
    """Split one segment transcript into sentences at terminal punctuation.

    Under-splitting is preferred over over-splitting: a missed boundary keeps the
    current one-line behaviour, while a wrong boundary tears one sentence into two
    caption lines. Every ambiguous case therefore stays joined.

    Not a boundary:
      * a terminal run longer than one character (``...``, ``?!``) — the model uses
        those for hesitation, not for the end of a thought
      * ``.`` between two digits (``3.14``, ``1.2.3``)
      * a terminal that is not followed by whitespace or the end of the text
      * the last terminal of the text — there is nothing left to split off
    """

    if not isinstance(text, str):
        raise TypeError("text must be a string")

    pieces: list[str] = []
    length = len(text)
    piece_start = 0
    index = 0
    while index < length:
        if text[index] not in _TERMINALS:
            index += 1
            continue

        run_end = index
        while run_end < length and text[run_end] in _TERMINALS:
            run_end += 1
        if run_end - index > 1:
            index = run_end
            continue
        if text[index] == "." and _is_decimal_point(text, index):
            index += 1
            continue

        cut = run_end
        while cut < length and text[cut] in _CLOSERS:
            cut += 1
        if cut < length and not text[cut].isspace():
            index = cut
            continue
        if not text[cut:].strip():
            break

        pieces.append(text[piece_start:cut])
        piece_start = cut
        index = cut

    pieces.append(text[piece_start:])
    return _clean(pieces)


def _is_decimal_point(text: str, index: int) -> bool:
    return (
        index > 0
        and text[index - 1].isdigit()
        and index + 1 < len(text)
        and text[index + 1].isdigit()
    )


def _clean(pieces: list[str]) -> list[str]:
    """Strip padding, drop empty pieces and absorb pieces that carry no words."""

    cleaned: list[str] = []
    carry = ""
    for piece in pieces:
        candidate = f"{carry}{piece.strip()}"
        carry = ""
        if not candidate:
            continue
        if any(character.isalnum() for character in candidate):
            cleaned.append(candidate)
        elif cleaned:
            cleaned[-1] += candidate
        else:
            carry = candidate
    if carry:
        cleaned.append(carry)
    return cleaned
