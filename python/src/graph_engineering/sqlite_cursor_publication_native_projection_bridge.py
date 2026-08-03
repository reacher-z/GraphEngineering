"""Import-leaf, one-shot P9 bridge for the NP1 lower-source reader."""

from __future__ import annotations

from collections.abc import Callable


def _native_projection_bridge_cell() -> tuple[
    Callable[
        [Callable[[object, object, object], object]],
        None,
    ],
    Callable[[object, object, object], object],
]:
    runtime_error_type = RuntimeError
    installed: Callable[[object, object, object], object] | None = None

    def install(
        reprove: Callable[[object, object, object], object],
    ) -> None:
        nonlocal installed
        if installed is not None:
            raise runtime_error_type("GE_SQLITE_P11_NATIVE_PROJECTION_BRIDGE_REPLAY")
        installed = reprove

    def invoke_reprove(owner: object, receipt: object, composition: object) -> object:
        if installed is None:
            raise runtime_error_type("GE_SQLITE_P11_NATIVE_PROJECTION_BRIDGE_MISSING")
        return installed(owner, receipt, composition)

    return install, invoke_reprove


(
    _install_sqlite_cursor_publication_native_projection_bridge_intrinsic,
    _invoke_sqlite_cursor_publication_native_projection_reproof_intrinsic,
) = _native_projection_bridge_cell()


def _native_projection_pipeline_cell() -> tuple[
    Callable[[Callable[[object, object, object, object], object]], None],
    Callable[[Callable[[object, object], tuple[object, object]]], None],
    Callable[[Callable[[object], None]], None],
    Callable[[object, object, object, object], tuple[object, object]],
]:
    base_exception_type = BaseException
    runtime_error_type = RuntimeError
    producer: Callable[[object, object, object, object], object] | None = None
    adopter: Callable[[object, object], tuple[object, object]] | None = None
    abandoner: Callable[[object], None] | None = None

    def install_producer(
        installed: Callable[[object, object, object, object], object],
    ) -> None:
        nonlocal producer
        if producer is not None:
            raise runtime_error_type("GE_SQLITE_P11_NATIVE_PROJECTION_PRODUCER_REPLAY")
        producer = installed

    def install_adopter(
        installed: Callable[[object, object], tuple[object, object]],
    ) -> None:
        nonlocal adopter
        if adopter is not None:
            raise runtime_error_type("GE_SQLITE_P11_NATIVE_PROJECTION_ADOPTER_REPLAY")
        adopter = installed

    def install_abandoner(installed: Callable[[object], None]) -> None:
        nonlocal abandoner
        if abandoner is not None:
            raise runtime_error_type("GE_SQLITE_P11_NATIVE_PROJECTION_ABANDONER_REPLAY")
        abandoner = installed

    def invoke(
        owner: object,
        begin_receipt: object,
        composition: object,
        summary: object,
    ) -> tuple[object, object]:
        if producer is None or adopter is None or abandoner is None:
            raise runtime_error_type("GE_SQLITE_P11_NATIVE_PROJECTION_PIPELINE_MISSING")
        receipt = producer(owner, begin_receipt, composition, summary)
        try:
            return adopter(composition, receipt)
        except base_exception_type as primary:
            try:  # noqa: SIM105 -- cleanup cannot replace exact adoption primary
                abandoner(receipt)
            except base_exception_type:
                pass
            raise primary

    return install_producer, install_adopter, install_abandoner, invoke


(
    _install_sqlite_cursor_publication_native_projection_producer_intrinsic,
    _install_sqlite_cursor_publication_native_projection_adopter_intrinsic,
    _install_sqlite_cursor_publication_native_projection_abandoner_intrinsic,
    _invoke_sqlite_cursor_publication_native_projection_pipeline_intrinsic,
) = _native_projection_pipeline_cell()


def _native_projection_receipt_views_cell() -> tuple[
    Callable[[Callable[[object, object], object], Callable[[object, object], int]], None],
    Callable[[object, object], object],
    Callable[[object, object], int],
]:
    runtime_error_type = RuntimeError
    snapshotter: Callable[[object, object], object] | None = None
    consumer: Callable[[object, object], int] | None = None

    def install(
        installed_snapshotter: Callable[[object, object], object],
        installed_consumer: Callable[[object, object], int],
    ) -> None:
        nonlocal snapshotter, consumer
        if snapshotter is not None or consumer is not None:
            raise runtime_error_type("GE_SQLITE_P11_NATIVE_PROJECTION_VIEWS_REPLAY")
        snapshotter = installed_snapshotter
        consumer = installed_consumer

    def snapshot(composition: object, receipt: object) -> object:
        if snapshotter is None:
            raise runtime_error_type("GE_SQLITE_P11_NATIVE_PROJECTION_VIEWS_MISSING")
        return snapshotter(composition, receipt)

    def consume(composition: object, receipt: object) -> int:
        if consumer is None:
            raise runtime_error_type("GE_SQLITE_P11_NATIVE_PROJECTION_VIEWS_MISSING")
        return consumer(composition, receipt)

    return install, snapshot, consume


(
    _install_sqlite_cursor_publication_native_projection_receipt_views_intrinsic,
    _invoke_sqlite_cursor_publication_native_projection_receipt_snapshot_intrinsic,
    _invoke_sqlite_cursor_publication_native_projection_receipt_consume_intrinsic,
) = _native_projection_receipt_views_cell()


def _seal_sqlite_cursor_publication_native_projection_bridge_intrinsic() -> None:
    """Erase the one-shot bootstrap surface after every participant is bound."""

    namespace = globals()
    for name in (
        "_native_projection_bridge_cell",
        "_install_sqlite_cursor_publication_native_projection_bridge_intrinsic",
        "_invoke_sqlite_cursor_publication_native_projection_reproof_intrinsic",
        "_native_projection_pipeline_cell",
        "_install_sqlite_cursor_publication_native_projection_producer_intrinsic",
        "_install_sqlite_cursor_publication_native_projection_adopter_intrinsic",
        "_install_sqlite_cursor_publication_native_projection_abandoner_intrinsic",
        "_invoke_sqlite_cursor_publication_native_projection_pipeline_intrinsic",
        "_native_projection_receipt_views_cell",
        "_install_sqlite_cursor_publication_native_projection_receipt_views_intrinsic",
        "_invoke_sqlite_cursor_publication_native_projection_receipt_snapshot_intrinsic",
        "_invoke_sqlite_cursor_publication_native_projection_receipt_consume_intrinsic",
        "_seal_sqlite_cursor_publication_native_projection_bridge_intrinsic",
    ):
        namespace.pop(name, None)
