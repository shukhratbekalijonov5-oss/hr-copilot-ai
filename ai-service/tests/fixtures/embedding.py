"""A fake embedder whose vectors actually reflect the text.

The obvious fake — return `[1, 0, 0, 0]` for everything — makes every pair of
texts perfectly similar. That is not a neutral simplification: matching
compares a requirement's retrieval score against a threshold, so a fake that
reports 1.0 for unrelated text pushes every requirement into
NEEDS_HUMAN_REVIEW and hides exactly the bugs these tests exist to catch.

This one is a bag-of-words hash: deterministic, cheap, no model to download,
and similar text genuinely scores higher than dissimilar text.
"""

from __future__ import annotations

import math
import re

DIMENSION = 64


def _tokens(text: str) -> list[str]:
    return re.findall(r"[a-z0-9.+#]+", (text or "").lower())


def embed(text: str) -> list[float]:
    """A normalized vector where shared vocabulary means shared direction."""
    vector = [0.0] * DIMENSION
    for token in _tokens(text):
        vector[hash(token) % DIMENSION] += 1.0
    norm = math.sqrt(sum(v * v for v in vector))
    if norm == 0:
        # An empty string has no direction; a zero vector scores 0 against
        # everything, which is the honest answer.
        return vector
    return [v / norm for v in vector]


class FakeEmbedder:
    dimension = DIMENSION

    def encode_query(self, text: str) -> list[float]:
        return embed(text)

    def encode_passages(self, texts):
        return [embed(t) for t in texts]
