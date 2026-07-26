"""Process-local asyncio locks shared by store instances on one event loop."""

from __future__ import annotations

import asyncio
from weakref import WeakKeyDictionary

_LOCKS: WeakKeyDictionary[asyncio.AbstractEventLoop, dict[str, asyncio.Lock]] = (
    WeakKeyDictionary()
)


def process_lock(key: str) -> asyncio.Lock:
    loop = asyncio.get_running_loop()
    locks = _LOCKS.setdefault(loop, {})
    return locks.setdefault(key, asyncio.Lock())
