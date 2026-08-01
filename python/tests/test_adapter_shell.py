"""The shell adapter: declaration, argument construction and a refusal.

Nothing here launches anything.  The point of these tests is that nothing
*could*: the module has no execution path, and the one call surface it exposes
returns a structured refusal.
"""

from __future__ import annotations

import ast
import asyncio
import inspect
from typing import Any

import pytest

from graph_engineering.adapters import (
    DENIAL_REASONS,
    SHELL_EXECUTION_BLOCKING_TASK,
    SHELL_EXECUTION_CAPABILITY_DOMAIN,
    SHELL_EXECUTION_DENIAL_REASON,
    SHELL_EXECUTION_ISOLATION_CODE,
    ProcessLaunchSpec,
    create_shell_adapter,
    shell_adapter,
    validate_descriptor,
)
from tests.adapter_corpus import descriptor_for, request_from

DECLARED_CALL = {
    "op": "replace",
    "path": "/processCall",
    "value": {
        "argumentVector": ["/usr/bin/ge-mock-tool", "--mock"],
        "environment": ["PATH"],
        "stdinBytes": 0,
    },
}


def adapter() -> Any:
    return create_shell_adapter(descriptor_for("shell-mock"))


def details(envelope: Any) -> dict[str, str]:
    return {field.name: field.value for field in envelope.provider_safe_fields}


# ---------------------------------------------------------------------------
# Declaration
# ---------------------------------------------------------------------------


def test_the_shell_descriptor_is_internally_consistent() -> None:
    descriptor = descriptor_for("shell-mock")
    assert validate_descriptor(descriptor) is True
    assert descriptor.process is not None
    assert descriptor.process.shell_expansion is False
    assert descriptor.process.argument_vector[0] == descriptor.process.executable_path
    assert descriptor.network is None
    assert descriptor.mcp is None


def test_the_shell_adapter_declares_only_what_it_supports() -> None:
    shell = adapter()
    assert shell.capabilities() == ("cancellation",)
    assert shell.supports("cancellation") is True
    assert shell.supports("streaming") is False


# ---------------------------------------------------------------------------
# Argument construction
# ---------------------------------------------------------------------------


def test_the_declared_argument_vector_is_an_exact_prefix_by_construction() -> None:
    call = adapter().build_process_call(ProcessLaunchSpec(arguments=("--extra", "value")))
    assert call.argument_vector == ("/usr/bin/ge-mock-tool", "--mock", "--extra", "value")
    assert call.stdin_bytes == 0


def test_environment_names_are_canonically_ordered() -> None:
    call = adapter().build_process_call(ProcessLaunchSpec(environment=("PATH", "GE_MOCK_MODE")))
    assert call.environment == ("GE_MOCK_MODE", "PATH")


def test_a_launch_can_be_authorized_without_any_host_effect() -> None:
    planned = adapter().plan_launch(request_from([DECLARED_CALL]))
    assert planned.ok
    plan = planned.value
    assert plan.executable_path == "/usr/bin/ge-mock-tool"
    assert plan.argument_vector == ("/usr/bin/ge-mock-tool", "--mock")
    assert plan.working_directory == "/var/empty"
    assert plan.shell_expansion is False
    assert plan.stdin_policy == "closed"
    assert plan.max_processes == 8
    assert plan.cancel_signal == "SIGTERM"


@pytest.mark.parametrize(
    ("mutation", "reason"),
    [
        (
            {
                "argumentVector": ["/usr/bin/other-tool", "--mock"],
                "environment": [],
                "stdinBytes": 0,
            },
            "executable-not-authorized",
        ),
        (
            {
                "argumentVector": ["/usr/bin/ge-mock-tool", "--other"],
                "environment": [],
                "stdinBytes": 0,
            },
            "executable-not-authorized",
        ),
        (
            {
                "argumentVector": ["/usr/bin/ge-mock-tool", "--mock"],
                "environment": ["SECRET_TOKEN"],
                "stdinBytes": 0,
            },
            "environment-not-allowlisted",
        ),
        (
            {
                "argumentVector": ["/usr/bin/ge-mock-tool", "--mock"],
                "environment": ["PATH"],
                "stdinBytes": 8,
            },
            "stdin-policy",
        ),
        (
            {
                "argumentVector": ["/usr/bin/ge-mock-tool", "--mock", "payload\x00injected"],
                "environment": [],
                "stdinBytes": 0,
            },
            "executable-not-authorized",
        ),
    ],
)
def test_a_malformed_call_reports_its_process_rule_not_the_blanket_refusal(
    mutation: dict[str, Any], reason: str
) -> None:
    request = request_from([{"op": "replace", "path": "/processCall", "value": mutation}])
    planned = adapter().plan_launch(request)
    assert not planned.ok
    assert planned.error.code == "GE_ADAPTER_POLICY_DENIED"
    assert planned.error.denial_reason == reason

    outcome = asyncio.run(adapter().call(request))
    assert not outcome.ok
    assert outcome.error.denial_reason == reason


# ---------------------------------------------------------------------------
# The refusal
# ---------------------------------------------------------------------------


def test_execution_refuses_with_a_closed_denial_reason_and_the_isolation_vocabulary() -> None:
    outcome = asyncio.run(adapter().call(request_from([DECLARED_CALL])))
    assert not outcome.ok
    error = outcome.error
    assert error.code == "GE_ADAPTER_POLICY_DENIED"
    assert error.denial_reason == SHELL_EXECUTION_DENIAL_REASON
    assert SHELL_EXECUTION_DENIAL_REASON in DENIAL_REASONS
    assert error.boundary == "pre-dispatch"
    assert error.retryable is False
    assert error.effect_disposition == "not-applied"
    assert error.usage_disposition == "none"
    assert error.usage is None
    assert error.provider_request_id is None
    detail = details(error)
    assert detail["blocking-task"] == SHELL_EXECUTION_BLOCKING_TASK == "D12-PY-ISOLATION-046"
    assert detail["capability-domain"] == SHELL_EXECUTION_CAPABILITY_DOMAIN == "process"
    assert detail["isolation-code"] == SHELL_EXECUTION_ISOLATION_CODE
    assert detail["rule"] == "none"


def test_the_refusal_never_claims_a_capability_the_inventory_does_not_contain() -> None:
    outcome = asyncio.run(adapter().call(request_from([DECLARED_CALL])))
    assert not outcome.ok
    # adapter-semantics 4.1 pins the CAPABILITY_UNSUPPORTED message to name a
    # member of the closed sixteen-member inventory.  None denotes subprocess
    # execution, so reporting that code here would be a false statement.
    assert outcome.error.code != "GE_ADAPTER_CAPABILITY_UNSUPPORTED"
    assert "Adapter capability" not in outcome.error.message
    assert "isolation provider" in outcome.error.message


def test_the_refusal_is_produced_for_every_attempt_index_within_the_ceiling() -> None:
    from graph_engineering.adapters import AdapterCallOptions

    for attempt in range(1, descriptor_for("shell-mock").retry_policy.max_attempts + 1):
        outcome = asyncio.run(
            adapter().call(request_from([DECLARED_CALL]), AdapterCallOptions(attempt=attempt))
        )
        assert not outcome.ok
        assert outcome.error.attempt == attempt


# ---------------------------------------------------------------------------
# There is nothing here to disable
# ---------------------------------------------------------------------------


def test_the_module_imports_no_execution_facility() -> None:
    tree = ast.parse(inspect.getsource(shell_adapter))
    imported: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module is not None and node.level == 0:
            imported.add(node.module.split(".")[0])
    assert imported.isdisjoint({"subprocess", "os", "shutil", "pty", "signal", "multiprocessing"})
    for name in ("subprocess", "os", "shutil", "pty"):
        assert not hasattr(shell_adapter, name)


def test_no_public_surface_can_launch_anything() -> None:
    shell = adapter()
    surface = {name for name in dir(shell) if not name.startswith("_")}
    assert surface == {
        "build_process_call",
        "call",
        "capabilities",
        "descriptor",
        "plan_launch",
        "preflight",
        "refuse_execution",
        "supports",
    }
