"""Pytest collection support for this course module directory.

Every course module ships sibling modules with the same file names
(``handlers.py``, ``wrong.py``, ``wrong_test.py``).  Under pytest's default
``prepend`` import mode those basenames collide in ``sys.modules`` when tests
from more than one module directory are collected in a single invocation
(e.g. ``pytest examples/course/module-01/wrong_test.py
examples/course/module-02/wrong_test.py``).

This hook evicts a cached module that belongs to a *different* course module
directory right before a ``wrong_test.py`` from this layout is imported, so
each directory's tests always import their own siblings.  It changes nothing
when a single module's tests run alone.
"""

from __future__ import annotations

import sys
from pathlib import Path

_SIBLINGS = ("wrong_test", "handlers", "wrong")


def pytest_collectstart(collector: object) -> None:
    path = getattr(collector, "path", None)
    if path is None or Path(path).name != "wrong_test.py":
        return
    directory = Path(path).parent
    for name in _SIBLINGS:
        module = sys.modules.get(name)
        file = getattr(module, "__file__", None) if module is not None else None
        if file is not None and Path(file).parent != directory:
            del sys.modules[name]
