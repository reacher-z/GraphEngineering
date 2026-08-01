"""Native Python Graph IR pattern constructors.

Only one pattern lives here today: the Pattern 01 multi-source research
diamond.  It is the Python peer of ``researchDiamond`` in
``@graph-engineering/patterns``, and the two are required to construct the
*same* graph — the bundle runners in
``examples/patterns/research-diamond/`` assert that both languages reproduce
the committed canonical document byte-for-byte after canonicalization.

This module is not a port of the whole TypeScript pattern package.  The other
three constructors (``routedBranches``, ``verifiedFanout``, ``loopUntilDry``)
have no Python peer, and nothing here should be read as implying they do.
"""

from __future__ import annotations

from .research_diamond import PatternInputError, ResearchSource, research_diamond

__all__ = [
    "PatternInputError",
    "ResearchSource",
    "research_diamond",
]
