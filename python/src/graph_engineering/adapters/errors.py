"""The failure carrier every rule in this package raises.

``code`` is the only portable fact.  ``rule`` is a stable diagnostic identifier
from the register of adapter-semantics 12 — normative to report, never an
authorization fact.  adapter-semantics 9.5 requires it because fourteen codes
cannot distinguish 131 rules.
"""

from __future__ import annotations

from typing import NoReturn

from .types import AdapterErrorCode, DenialReason


class AdapterContractError(Exception):
    """A contract rejection: one portable code and one register rule."""

    __slots__ = ("code", "denial_reason", "rule")

    def __init__(
        self,
        code: AdapterErrorCode,
        rule: str,
        message: str,
        denial_reason: DenialReason | None = None,
    ) -> None:
        super().__init__(message)
        self.code: AdapterErrorCode = code
        self.rule = rule
        self.denial_reason: DenialReason | None = denial_reason

    @property
    def message(self) -> str:
        return str(self)


def fail(
    code: AdapterErrorCode,
    rule: str,
    message: str,
    denial_reason: DenialReason | None = None,
) -> NoReturn:
    raise AdapterContractError(code, rule, message, denial_reason)


def is_adapter_contract_error(value: object) -> bool:
    return isinstance(value, AdapterContractError)
