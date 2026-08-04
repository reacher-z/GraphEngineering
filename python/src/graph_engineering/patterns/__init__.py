"""Native Python Graph IR pattern constructors.

Two patterns live here today: the Pattern 01 multi-source research diamond
and the Pattern 10 scheduled ecosystem scan in its honest reduced form.  Each
is the Python peer of the same-named constructor in
``@graph-engineering/patterns`` (``researchDiamond`` and ``ecosystemScan``),
and each language pair is required to construct the *same* graph — the bundle
runners in ``examples/patterns/research-diamond/`` and
``examples/patterns/ecosystem-scan/`` assert that both languages reproduce
the committed canonical document byte-for-byte after canonicalization.

This module is not a port of the whole TypeScript pattern package.  The other
three constructors (``routedBranches``, ``verifiedFanout``, ``loopUntilDry``)
have no Python peer, and nothing here should be read as implying they do.
"""

from __future__ import annotations

from .ecosystem_scan import ScanSource, ecosystem_scan
from .research_diamond import PatternInputError, ResearchSource, research_diamond

__all__ = [
    "PatternInputError",
    "ResearchSource",
    "ScanSource",
    "ecosystem_scan",
    "research_diamond",
]
