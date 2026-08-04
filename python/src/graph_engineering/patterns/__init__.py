"""Native Python Graph IR pattern constructors.

Three patterns live here today: the Pattern 01 multi-source research diamond,
the Pattern 02 cited deep research and the Pattern 10 scheduled ecosystem
scan, the latter two in their honest reduced forms.  Each is the Python peer
of the same-named constructor in ``@graph-engineering/patterns``
(``researchDiamond``, ``citedResearch`` and ``ecosystemScan``), and each
language pair is required to construct the *same* graph — the bundle runners
in ``examples/patterns/research-diamond/``,
``examples/patterns/cited-research/`` and ``examples/patterns/ecosystem-scan/``
assert that both languages reproduce the committed canonical document
byte-for-byte after canonicalization.  :func:`claim_id` is likewise the exact
peer of the TypeScript ``claimId`` claim-identity rule.

This module is not a port of the whole TypeScript pattern package.  The other
three constructors (``routedBranches``, ``verifiedFanout``, ``loopUntilDry``)
have no Python peer, and nothing here should be read as implying they do.
"""

from __future__ import annotations

from .cited_research import CitedSource, cited_research, claim_id
from .ecosystem_scan import ScanSource, ecosystem_scan
from .research_diamond import PatternInputError, ResearchSource, research_diamond

__all__ = [
    "CitedSource",
    "PatternInputError",
    "ResearchSource",
    "ScanSource",
    "cited_research",
    "claim_id",
    "ecosystem_scan",
    "research_diamond",
]
