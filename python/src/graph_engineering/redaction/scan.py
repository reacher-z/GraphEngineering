"""Defense-in-depth canary and credential scanning before a sink write.

Section 7 places a canary/credential scan between receipt validation and
canonicalization.  The scan is defense in depth, not the protection mechanism:
Section 13 is explicit that this contract does not detect every transformed,
fragmented, inferred, or externally exfiltrated secret.  A literal scanner finds
a value that leaked verbatim; it cannot find one that was hashed, chunked, or
paraphrased.

Section 10 also constrains the report: a detection reports only the canary ID and
the sink, never the detected value.
"""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from typing import Final

# Encoding forms checked for every registered canary. Section 12 names literal
# UTF-8 and obvious JSON, URL, base64, hexadecimal, UTF-16 LE/BE, and
# compressed-member forms; compressed members are a campaign-scanner concern for
# archive bytes and are deliberately not attempted inside the pre-sink guard.
SCANNED_FORMS: Final[tuple[str, ...]] = (
    "utf-8",
    "json-escaped",
    "percent-encoded",
    "base64",
    "base64url",
    "hex",
    "utf-16-le",
    "utf-16-be",
)


@dataclass(frozen=True, slots=True)
class CanaryDetection:
    """A metadata-only detection report."""

    canary_id: str
    sink: str
    form: str


def _percent_encode(raw: bytes) -> bytes:
    return "".join(
        chr(byte)
        if chr(byte).isalnum() or chr(byte) in "-._~"
        else f"%{byte:02X}"
        for byte in raw
    ).encode("ascii")


def encoded_forms(value: str) -> dict[str, bytes]:
    """Every byte spelling of one canary that this scanner recognizes."""

    raw = value.encode("utf-8")
    escaped = json.dumps(value, ensure_ascii=True)[1:-1].encode("ascii")
    return {
        "utf-8": raw,
        "json-escaped": escaped,
        "percent-encoded": _percent_encode(raw),
        "base64": base64.b64encode(raw).rstrip(b"="),
        "base64url": base64.urlsafe_b64encode(raw).rstrip(b"="),
        "hex": raw.hex().encode("ascii"),
        "utf-16-le": value.encode("utf-16-le", errors="surrogatepass"),
        "utf-16-be": value.encode("utf-16-be", errors="surrogatepass"),
    }


class CanaryRegistry:
    """Seeded synthetic canaries checked before every guarded sink write."""

    def __init__(self) -> None:
        self._forms: dict[str, dict[str, bytes]] = {}

    def register(self, canary_id: str, value: str) -> None:
        if type(canary_id) is not str or not canary_id:
            raise ValueError("a canary identifier is required")
        if type(value) is not str or len(value) < 8:
            # A short canary would produce false positives against ordinary
            # metadata and would make the scan useless.
            raise ValueError("a canary value must be at least eight characters")
        self._forms[canary_id] = encoded_forms(value)

    def registered(self) -> tuple[str, ...]:
        return tuple(sorted(self._forms))

    def scan(self, payload: bytes, *, sink: str) -> CanaryDetection | None:
        """Return the first detection, or ``None`` for clean bytes."""

        lowered = payload.lower()
        for canary_id in sorted(self._forms):
            for form, encoded in self._forms[canary_id].items():
                if not encoded:
                    continue
                haystack = lowered if form == "hex" else payload
                needle = encoded.lower() if form == "hex" else encoded
                if needle in haystack:
                    return CanaryDetection(canary_id=canary_id, sink=sink, form=form)
        return None
