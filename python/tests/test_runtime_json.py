from __future__ import annotations

import asyncio
import json
from typing import Any, cast

import pytest

from graph_engineering import (
    FailureCode,
    NodeContext,
    NodeStatus,
    RunStatus,
    compile_graph,
    run_graph,
)
from graph_engineering.portable_json import PortableJsonError, portable_json_snapshot

MAX_SAFE_INTEGER = 2**53 - 1


class CustomList(list[Any]):
    pass


class CustomDict(dict[str, Any]):
    pass


class CustomString(str):
    pass


class CustomInt(int):
    pass


def node(node_id: str, **overrides: Any) -> dict[str, Any]:
    return {
        "id": node_id,
        "kind": "transform",
        "inputSchema": {},
        "outputSchema": {},
        "config": {},
        **overrides,
    }


def graph(**overrides: Any) -> dict[str, Any]:
    document: dict[str, Any] = {
        "apiVersion": "graphengineering.reacher-z.github.io/v1alpha1",
        "kind": "Graph",
        "metadata": {"name": "runtime-json-test", "version": "1"},
        "inputSchema": {},
        "outputSchema": {},
        "entrypoints": ["root"],
        "outputs": {"result": {"node": "root"}},
        "nodes": [node("root")],
        "edges": [],
    }
    document.update(overrides)
    return document


def run_with_input(value: Any) -> Any:
    return asyncio.run(run_graph(compile_graph(graph()), value))


@pytest.mark.parametrize(
    ("value", "case"),
    [
        (float("nan"), "nan"),
        (float("inf"), "positive-infinity"),
        (float("-inf"), "negative-infinity"),
        (MAX_SAFE_INTEGER + 1, "large-positive-integer"),
        (-(MAX_SAFE_INTEGER + 1), "large-negative-integer"),
        (float(MAX_SAFE_INTEGER + 1), "large-integer-valued-float"),
        ({"value": MAX_SAFE_INTEGER + 1}, "nested-large-integer"),
        ({"not", "json"}, "set"),
        (("not", "json"), "tuple"),
        ({1: "non-string-key"}, "non-string-key"),
        (object(), "class-instance"),
    ],
    ids=lambda item: item if isinstance(item, str) else None,
)
def test_graph_input_rejects_non_portable_values(value: Any, case: str) -> None:
    del case
    with pytest.raises(
        TypeError,
        match=r"graph input must be a portable finite JSON value",
    ):
        run_with_input(value)


def test_graph_input_rejects_cycles_without_leaking_recursion_error() -> None:
    cyclic_list: list[Any] = []
    cyclic_list.append(cyclic_list)
    cyclic_dict: dict[str, Any] = {}
    cyclic_dict["self"] = cyclic_dict

    for value in (cyclic_list, cyclic_dict):
        with pytest.raises(
            TypeError,
            match=r"graph input must be a portable finite JSON value",
        ):
            run_with_input(value)


def test_graph_input_rejects_container_subclasses() -> None:
    for value in (CustomList(), CustomDict(), CustomString("text"), CustomInt(1)):
        with pytest.raises(TypeError, match=r"portable finite JSON"):
            run_with_input(value)


def test_portable_boundary_accepts_safe_primitives_and_builtin_containers() -> None:
    value = {
        "null": None,
        "string": "portable",
        "boolean": True,
        "integers": [-MAX_SAFE_INTEGER, 0, MAX_SAFE_INTEGER],
        "floats": [-1.5, 0.25, 1.0, float(MAX_SAFE_INTEGER)],
        "containers": [{"nested": []}],
    }

    result = run_with_input(value)

    assert result.status is RunStatus.SUCCEEDED
    assert dict(result.outputs or {}) == {"result": value}


def test_integer_valued_floats_and_negative_zero_use_javascript_json_semantics() -> None:
    snapshot = portable_json_snapshot(
        {"negativeZero": -0.0, "positiveZero": 0.0, "integer": 1.0, "fraction": -0.125}
    )

    assert snapshot == {
        "negativeZero": 0,
        "positiveZero": 0,
        "integer": 1,
        "fraction": -0.125,
    }
    assert isinstance(snapshot, dict)
    assert type(snapshot["negativeZero"]) is int
    assert type(snapshot["positiveZero"]) is int
    assert type(snapshot["integer"]) is int
    assert type(snapshot["fraction"]) is float


def test_scheduler_normalizes_negative_zero_in_input_and_output() -> None:
    def observe(context: NodeContext) -> Any:
        payload = cast(dict[str, Any], context.input)
        assert payload["value"] == 0
        assert type(payload["value"]) is int
        return {"value": -0.0}

    result = asyncio.run(
        run_graph(compile_graph(graph()), {"value": -0.0}, {"root": observe})
    )

    assert result.status is RunStatus.SUCCEEDED
    assert result.nodes["root"].value == {"value": 0}
    assert type(cast(dict[str, Any], result.nodes["root"].value)["value"]) is int


def test_portable_json_normalizes_surrogate_pairs_and_rejects_key_collisions() -> None:
    scalar = json.loads(r'"\ud83d\ude00"')
    explicit_pair = "\ud83d\ude00"

    snapshot = portable_json_snapshot({explicit_pair: explicit_pair})

    assert snapshot == {scalar: scalar}
    with pytest.raises(
        PortableJsonError,
        match="object keys collide after surrogate-pair normalization",
    ):
        portable_json_snapshot({explicit_pair: 1, scalar: 2})


def test_repeated_alias_is_allowed_and_copied_into_independent_values() -> None:
    shared: dict[str, Any] = {"items": []}
    caller_input = {"left": shared, "right": shared}

    def mutate_one_alias(context: NodeContext) -> Any:
        payload = cast(dict[str, Any], context.input)
        payload["left"]["items"].append("left-only")
        assert payload["right"]["items"] == []
        return payload

    result = asyncio.run(
        run_graph(
            compile_graph(graph()),
            caller_input,
            {"root": mutate_one_alias},
        )
    )

    assert shared == {"items": []}
    shared["items"].append("caller-after-run")
    assert result.nodes["root"].input == {
        "left": {"items": []},
        "right": {"items": []},
    }
    assert dict(result.outputs or {}) == {
        "result": {
            "left": {"items": ["left-only"]},
            "right": {"items": []},
        }
    }


def test_cyclic_handler_output_is_structured_invalid_output_and_can_retry() -> None:
    compiled = compile_graph(
        graph(nodes=[node("root", retry={"maxAttempts": 2})])
    )
    calls = 0

    def cyclic_output(_: NodeContext) -> Any:
        nonlocal calls
        calls += 1
        value: list[Any] = []
        value.append(value)
        return value

    result = asyncio.run(run_graph(compiled, {}, {"root": cyclic_output}))

    assert result.status is RunStatus.FAILED
    assert calls == 2
    assert result.total_attempts == 2
    assert result.nodes["root"].status is NodeStatus.FAILED
    assert result.nodes["root"].failure is not None
    assert result.nodes["root"].failure.code is FailureCode.INVALID_OUTPUT
    assert result.nodes["root"].failure.exception_type == "InvalidOutputError"
    assert not result.nodes["root"].failure.retryable


@pytest.mark.parametrize(
    "value",
    [
        float("nan"),
        float("inf"),
        MAX_SAFE_INTEGER + 1,
        {"value": MAX_SAFE_INTEGER + 1},
        ("tuple",),
        {"set"},
        CustomList(),
        CustomDict(),
        CustomString("text"),
        CustomInt(1),
        object(),
    ],
)
def test_other_non_portable_handler_outputs_are_structured(value: Any) -> None:
    result = asyncio.run(
        run_graph(
            compile_graph(graph()),
            {},
            {"root": lambda _: value},
        )
    )

    assert result.status is RunStatus.FAILED
    assert result.nodes["root"].failure is not None
    assert result.nodes["root"].failure.code is FailureCode.INVALID_OUTPUT


def test_retry_attempts_receive_fresh_input_and_graph_input_snapshots() -> None:
    caller_input: dict[str, Any] = {"items": []}
    observations: list[tuple[list[Any], list[Any]]] = []

    def retrying(context: NodeContext) -> Any:
        attempt_input = cast(dict[str, Any], context.input)
        attempt_graph_input = cast(dict[str, Any], context.graph_input)
        observations.append(
            (list(attempt_input["items"]), list(attempt_graph_input["items"]))
        )
        attempt_input["items"].append(context.attempt)
        attempt_graph_input["items"].append("private")
        if context.attempt == 1:
            raise RuntimeError("retry with a clean snapshot")
        return attempt_input

    result = asyncio.run(
        run_graph(
            compile_graph(
                graph(nodes=[node("root", retry={"maxAttempts": 2})])
            ),
            caller_input,
            {"root": retrying},
        )
    )

    assert result.status is RunStatus.SUCCEEDED
    assert observations == [([], []), ([], [])]
    assert caller_input == {"items": []}
    assert result.nodes["root"].input == {"items": []}
    assert dict(result.outputs or {}) == {"result": {"items": [2]}}


def test_parallel_branches_cannot_mutate_upstream_or_each_other() -> None:
    executor_value: dict[str, Any] = {"items": []}
    compiled = compile_graph(
        graph(
            outputs={"left": {"node": "left"}, "right": {"node": "right"}},
            nodes=[node("root"), node("left"), node("right")],
            edges=[
                {
                    "id": "root-left",
                    "from": {"node": "root"},
                    "to": {"node": "left", "port": "payload"},
                },
                {
                    "id": "root-right",
                    "from": {"node": "root"},
                    "to": {"node": "right", "port": "payload"},
                },
            ],
        )
    )

    def mutate_left(context: NodeContext) -> Any:
        payload = cast(dict[str, Any], context.input)["payload"]
        completed_root = cast(dict[str, Any], context.completed["root"])
        payload["items"].append("left")
        completed_root["items"].append("completed-left")
        return len(payload["items"])

    def observe_right(context: NodeContext) -> Any:
        payload = cast(dict[str, Any], context.input)["payload"]
        completed_root = cast(dict[str, Any], context.completed["root"])
        return {
            "inputItems": list(payload["items"]),
            "completedItems": list(completed_root["items"]),
        }

    result = asyncio.run(
        run_graph(
            compiled,
            {},
            {"root": lambda _: executor_value, "left": mutate_left, "right": observe_right},
        )
    )

    assert result.status is RunStatus.SUCCEEDED
    assert executor_value == {"items": []}
    assert result.nodes["root"].value == {"items": []}
    assert result.nodes["left"].input == {"payload": {"items": []}}
    assert result.nodes["right"].input == {"payload": {"items": []}}
    assert dict(result.outputs or {}) == {
        "left": 1,
        "right": {"inputItems": [], "completedItems": []},
    }


def test_run_result_is_detached_from_executor_owned_output() -> None:
    executor_value: dict[str, Any] = {"nested": {"items": ["before"]}}

    result = asyncio.run(
        run_graph(
            compile_graph(graph()),
            {},
            {"root": lambda _: executor_value},
        )
    )
    executor_value["nested"]["items"].append("after")

    assert result.nodes["root"].value == {"nested": {"items": ["before"]}}
    assert dict(result.outputs or {}) == {
        "result": {"nested": {"items": ["before"]}}
    }


def test_async_output_is_snapshotted_before_scheduled_executor_mutation() -> None:
    executor_value: dict[str, Any] = {"items": []}

    async def return_then_mutate(_: NodeContext) -> Any:
        asyncio.get_running_loop().call_soon(
            executor_value["items"].append,
            "after-return",
        )
        return executor_value

    result = asyncio.run(
        run_graph(
            compile_graph(graph()),
            {},
            {"root": return_then_mutate},
        )
    )

    assert executor_value == {"items": ["after-return"]}
    assert result.nodes["root"].value == {"items": []}
    assert dict(result.outputs or {}) == {"result": {"items": []}}
