"""The shell / subprocess adapter — declaration and argument construction only.

Why this adapter does not execute
---------------------------------

``spec/isolation-semantics.md`` §0 states, without qualification, that no
isolation provider, capability policy engine, merge gate or approval runtime
exists in this repository, and that "a node executor has the ambient authority
of the host process that runs it".  A working execution path here would hand
arbitrary command execution to graph-supplied content with nothing between it
and the host, and adapter-semantics 10 requires deny by default.

So this adapter implements its descriptor obligations (``D-005``, ``D-022``,
``D-023``), its capability declaration, its share of the closed error taxonomy
and its argument-construction logic — and refuses to launch anything.  The
refusal is ``GE_ADAPTER_POLICY_DENIED`` with denial reason
``capability-approval``, and it carries the isolation contract's own vocabulary
as provider-safe detail: ``GE_ISO_PROVIDER_UNSUPPORTED`` in the ``process``
capability domain, blocked on ``D12-PY-ISOLATION-046``.

``GE_ADAPTER_CAPABILITY_UNSUPPORTED`` is deliberately *not* used.  The closed
sixteen-member capability inventory of adapter-semantics 4 has no member
denoting subprocess execution, and §4.1 pins that code's message to the exact
form ``Adapter capability '<capability>' required by request ...``.  Reporting
it would require naming a capability that does not exist, which would be a false
statement in an operator-facing message.  ``capability-approval`` is the accurate
denial reason: what is missing is the approval and isolation machinery the
capability contract requires, not a boundary feature of this adapter.

This module imports no ``subprocess``, no ``os`` and no ``shutil``.  There is no
execution path here to enable.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, replace
from typing import Final

from .base import (
    AdapterCallOptions,
    AdapterOutcome,
    AdapterResponse,
    ok,
    refused,
    run_preflight,
)
from .envelope import normalized_adapter_error
from .ordering import sort_by_code_point
from .types import (
    AdapterCapability,
    AdapterDescriptor,
    AdapterErrorEnvelope,
    AdapterRequest,
    DenialReason,
    PreflightOutcome,
    ProcessCall,
    ProviderMetricDeclaration,
    ProviderSafeField,
)

#: ``capability-manifest.schema.json#/$defs/code``.  No provider is implemented.
SHELL_EXECUTION_ISOLATION_CODE: Final = "GE_ISO_PROVIDER_UNSUPPORTED"
#: ``capability-manifest.schema.json#/$defs/capabilityDomain``.
SHELL_EXECUTION_CAPABILITY_DOMAIN: Final = "process"
#: The task that must land before this refusal can be lifted.
SHELL_EXECUTION_BLOCKING_TASK: Final = "D12-PY-ISOLATION-046"
#: The closed denial reason this refusal reports.
SHELL_EXECUTION_DENIAL_REASON: Final[DenialReason] = "capability-approval"
SHELL_EXECUTION_REFUSAL_MESSAGE: Final = (
    "subprocess execution is refused: no isolation provider exists, so a launch "
    "would run with the ambient authority of the host process"
)


@dataclass(frozen=True, slots=True)
class ProcessLaunchSpec:
    """What a caller asks for.  Asking is not authority."""

    #: Arguments appended after the descriptor's declared vector.
    arguments: tuple[str, ...] | None = None
    #: Requested environment names; anything outside the allowlist is refused.
    environment: tuple[str, ...] | None = None
    stdin_bytes: int | None = None

    @property
    def explicit(self) -> bool:
        return (
            self.arguments is not None
            or self.environment is not None
            or self.stdin_bytes is not None
        )


@dataclass(frozen=True, slots=True)
class ProcessLaunchPlan:
    """A fully constructed, fully bounded launch.

    Producing one performs no I/O and grants no authority; it is the value an
    isolation provider would consume once one exists.
    """

    executable_path: str
    argument_vector: tuple[str, ...]
    working_directory: str
    environment_names: tuple[str, ...]
    stdin_policy: str
    stdin_bytes: int
    shell_expansion: bool
    max_output_bytes: int
    max_duration_ms: int
    max_processes: int
    max_memory_bytes: int
    cancel_signal: str


class ShellAdapter:
    """Descriptor, capability declaration, taxonomy and argument construction."""

    __slots__ = ("_forbidden_markers", "_policy_metrics", "descriptor")

    def __init__(
        self,
        descriptor: AdapterDescriptor,
        *,
        budget_policy_allowed_provider_metrics: Sequence[ProviderMetricDeclaration] = (),
        forbidden_markers: Sequence[str] = (),
    ) -> None:
        self.descriptor = descriptor
        self._policy_metrics = tuple(budget_policy_allowed_provider_metrics)
        self._forbidden_markers = tuple(forbidden_markers)

    def capabilities(self) -> tuple[str, ...]:
        return self.descriptor.capabilities

    def supports(self, capability: AdapterCapability) -> bool:
        return capability in self.descriptor.capabilities

    def preflight(self, request: AdapterRequest) -> AdapterOutcome[PreflightOutcome]:
        return run_preflight(
            self.descriptor, request, self._policy_metrics, 1, self._forbidden_markers
        )

    def build_process_call(self, spec: ProcessLaunchSpec | None = None) -> ProcessCall:
        """The process call a launch spec implies.

        The declared argument vector is an exact prefix by construction
        (``P-024``), there is no implicit shell and no argument-string
        interpolation, and environment names are canonically ordered so two
        runtimes build the same call.
        """
        wanted = spec if spec is not None else ProcessLaunchSpec()
        profile = self.descriptor.process
        if profile is None:
            raise ValueError(
                f"shell adapter {self.descriptor.adapter_id!r} declares no process profile"
            )
        return ProcessCall(
            argument_vector=(*profile.argument_vector, *(wanted.arguments or ())),
            environment=sort_by_code_point(wanted.environment or ()),
            stdin_bytes=wanted.stdin_bytes or 0,
        )

    def plan_launch(
        self,
        request: AdapterRequest,
        spec: ProcessLaunchSpec | None = None,
    ) -> AdapterOutcome[ProcessLaunchPlan]:
        """Authorize a launch without performing it.

        Every process rule (``P-023``..``P-027``) runs here, so a caller can
        prove a command would be refused — or would be admitted — with no host
        effect whatsoever.
        """
        profile = self.descriptor.process
        if profile is None:
            raise ValueError(
                f"shell adapter {self.descriptor.adapter_id!r} declares no process profile"
            )
        # An explicit launch spec wins; otherwise a call the request already
        # carries is authorized as supplied, so a malformed caller-supplied
        # vector reports the process rule it violated rather than the blanket
        # refusal.
        if spec is not None and spec.explicit:
            call = self.build_process_call(spec)
        elif request.process_call is not None:
            call = request.process_call
        else:
            call = self.build_process_call()
        authorized = self.preflight(replace(request, process_call=call))
        if not authorized.ok:
            return refused(authorized.error)

        return ok(
            ProcessLaunchPlan(
                executable_path=profile.executable_path,
                argument_vector=call.argument_vector,
                working_directory=profile.working_directory,
                environment_names=call.environment,
                stdin_policy=profile.stdin_policy,
                stdin_bytes=call.stdin_bytes,
                shell_expansion=False,
                max_output_bytes=profile.max_output_bytes,
                max_duration_ms=profile.max_duration_ms,
                max_processes=profile.max_processes,
                max_memory_bytes=profile.max_memory_bytes,
                cancel_signal=profile.cancel_signal,
            )
        )

    def refuse_execution(self, request: AdapterRequest, attempt: int = 1) -> AdapterErrorEnvelope:
        """The refusal.

        It is produced only after the launch has been fully authorized, so a
        caller whose command is malformed still learns the precise process rule
        it violated instead of this blanket refusal.
        """
        return normalized_adapter_error(
            self.descriptor,
            request_id=request.request_id,
            attempt=attempt,
            code="GE_ADAPTER_POLICY_DENIED",
            side_effect_class=request.side_effect_class,
            denial_reason=SHELL_EXECUTION_DENIAL_REASON,
            message=SHELL_EXECUTION_REFUSAL_MESSAGE,
            detail=(
                _field("blocking-task", SHELL_EXECUTION_BLOCKING_TASK),
                _field("capability-domain", SHELL_EXECUTION_CAPABILITY_DOMAIN),
                _field("isolation-code", SHELL_EXECUTION_ISOLATION_CODE),
            ),
            # The rule register of adapter-semantics 12 names no rule for this
            # refusal, and an implementation may never invent a register
            # identifier.
            rule="none",
            forbidden_markers=self._forbidden_markers,
        )

    async def call(
        self,
        request: AdapterRequest,
        options: AdapterCallOptions | None = None,
    ) -> AdapterOutcome[AdapterResponse]:
        """Always refuses.  There is no execution path in this package."""
        settings = options if options is not None else AdapterCallOptions()
        planned = self.plan_launch(request, None)
        if not planned.ok:
            return refused(planned.error)
        return refused(self.refuse_execution(request, settings.attempt))


def _field(name: str, value: str) -> ProviderSafeField:
    return ProviderSafeField(name=name, value=value)


def create_shell_adapter(
    descriptor: AdapterDescriptor,
    *,
    budget_policy_allowed_provider_metrics: Sequence[ProviderMetricDeclaration] = (),
    forbidden_markers: Sequence[str] = (),
) -> ShellAdapter:
    return ShellAdapter(
        descriptor,
        budget_policy_allowed_provider_metrics=budget_policy_allowed_provider_metrics,
        forbidden_markers=forbidden_markers,
    )
