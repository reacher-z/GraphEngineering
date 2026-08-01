"""Unicode code-point ordering.

The contract orders capabilities, hosts, environment names, provider metrics,
usage resources and provider-safe detail fields by code point so that two
runtimes in two languages produce the same canonical document.  Python compares
``str`` by code point already, so this module is the naming of that fact rather
than an algorithm.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from itertools import pairwise


def compare_unicode_code_points(left: str, right: str) -> int:
    if left < right:
        return -1
    if left > right:
        return 1
    return 0


def is_sorted_by_code_point(values: Sequence[str]) -> bool:
    """Strictly ascending: equal neighbours are a duplicate, not an order."""
    return all(previous < current for previous, current in pairwise(values))


def sort_by_code_point(values: Iterable[str]) -> tuple[str, ...]:
    return tuple(sorted(values))
