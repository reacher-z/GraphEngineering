"""Conservative classification of Python SQLite callsite-discovery candidates.

The JavaScript discovery scanner deliberately reports every candidate as an
unknown route.  This module adds a separate, read-only triage layer.  It never
authorizes a route and it never removes a candidate.  A native receiver is
confirmed only from local structural evidence such as an exact ``sqlite3``
annotation, ``sqlite3.connect`` construction, or a same-scope alias of either.
"""

from __future__ import annotations

import ast
import hashlib
import json
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, TypeAlias

SQLiteNativeCallsiteCategory: TypeAlias = Literal[
    "confirmed-native-receiver",
    "wrapper-guard-or-test-like-production-probe",
    "false-positive",
    "unknown",
]

_CATEGORIES: tuple[SQLiteNativeCallsiteCategory, ...] = (
    "confirmed-native-receiver",
    "wrapper-guard-or-test-like-production-probe",
    "false-positive",
    "unknown",
)
_NATIVE_CONNECTION = "native-connection"
_NATIVE_CURSOR = "native-cursor"
_WRAPPER = "wrapper"
_NON_SQLITE = "non-sqlite"
_UNKNOWN = "unknown"
_PROVENANCE_KINDS = frozenset(
    {_NATIVE_CONNECTION, _NATIVE_CURSOR, _WRAPPER, _NON_SQLITE, _UNKNOWN}
)
_SQLITE_NATIVE_TYPES = frozenset({"sqlite3.Connection", "sqlite3.Cursor"})
_KNOWN_WRAPPER_TYPES = frozenset(
    {
        "graph_engineering.sqlite_operation_baseline_source."
        "SQLiteV1BaselineConnectionOwner",
    }
)


@dataclass(frozen=True, slots=True)
class SQLiteNativeCallsiteIdentity:
    """Stable source identity copied from one discovery candidate."""

    path: str
    line: int
    column: int
    method: str
    sql_origin: str
    occurrence: int


@dataclass(frozen=True, slots=True)
class SQLiteNativeCallsiteClassification:
    """One preserved candidate and its conservative triage result."""

    candidate_id: str
    identity: SQLiteNativeCallsiteIdentity
    category: SQLiteNativeCallsiteCategory
    reason: str
    scanner_receiver_confidence: str
    scanner_receiver_kind: str
    sql_status: str
    sql_shape: str
    sql_sha256: str | None
    sql_token: str | None

    def to_json_object(self) -> dict[str, object]:
        """Return a deterministic JSON-compatible representation."""

        return {
            "candidateId": self.candidate_id,
            "identity": {
                "path": self.identity.path,
                "line": self.identity.line,
                "column": self.identity.column,
                "method": self.identity.method,
                "sqlOrigin": self.identity.sql_origin,
                "occurrence": self.identity.occurrence,
            },
            "category": self.category,
            "reason": self.reason,
            "scannerEvidence": {
                "receiverConfidence": self.scanner_receiver_confidence,
                "receiverKind": self.scanner_receiver_kind,
            },
            "sqlEvidence": {
                "status": self.sql_status,
                "shape": self.sql_shape,
                "sha256": self.sql_sha256,
                "token": self.sql_token,
            },
        }


@dataclass(frozen=True, slots=True)
class SQLiteNativeCallsiteClassificationReport:
    """Complete, deterministic classification without a route-closure claim."""

    candidates: tuple[SQLiteNativeCallsiteClassification, ...]
    category_counts: tuple[tuple[SQLiteNativeCallsiteCategory, int], ...]

    def to_json_object(self) -> dict[str, object]:
        """Return the portable report object in a fixed key order."""

        counts = {category: count for category, count in self.category_counts}
        return {
            "schemaVersion": 1,
            "classificationPolicy": {
                "routeAuthorization": False,
                "routeClosureClaimed": False,
                "nameHeuristicsCanConfirmNativeReceiver": False,
                "crossFunctionReturnInference": False,
                "unknownCandidatesDropped": False,
            },
            "summary": {
                "inputPythonCandidateCount": len(self.candidates),
                "classifiedCandidateCount": len(self.candidates),
                "categoryCounts": counts,
                "unknownCount": counts["unknown"],
            },
            "candidates": [candidate.to_json_object() for candidate in self.candidates],
        }


@dataclass(frozen=True, slots=True)
class _Provenance:
    kind: str
    reason: str
    qualified_type: str | None = None

    def __post_init__(self) -> None:
        if self.kind not in _PROVENANCE_KINDS:
            raise ValueError("invalid SQLite callsite provenance")


@dataclass(frozen=True, slots=True)
class _Assignment:
    line: int
    column: int
    value: ast.expr | None
    annotation: ast.expr | None


class _SourceAnalyzer(ast.NodeVisitor):
    """Index lexical evidence without evaluating or importing the source."""

    def __init__(self, source: str, module_name: str) -> None:
        self.tree = ast.parse(source)
        self.module_name = module_name
        self.imports: dict[str, str] = {}
        self.classes: dict[str, ast.ClassDef] = {}
        self.calls: dict[tuple[int, int], list[ast.Call]] = defaultdict(list)
        self.assignments: dict[ast.AST, dict[str, list[_Assignment]]] = defaultdict(
            lambda: defaultdict(list)
        )
        self.attribute_assignments: dict[
            ast.ClassDef, dict[str, list[_Assignment]]
        ] = defaultdict(lambda: defaultdict(list))
        self.parameters: dict[ast.AST, dict[str, ast.expr | None]] = defaultdict(dict)
        self.node_scope: dict[ast.AST, ast.AST] = {}
        self.node_class: dict[ast.AST, ast.ClassDef | None] = {}
        self._scope_stack: list[ast.AST] = [self.tree]
        self._class_stack: list[ast.ClassDef] = []
        self.visit(self.tree)

    @property
    def scope(self) -> ast.AST:
        return self._scope_stack[-1]

    @property
    def current_class(self) -> ast.ClassDef | None:
        return self._class_stack[-1] if self._class_stack else None

    def generic_visit(self, node: ast.AST) -> None:
        self.node_scope[node] = self.scope
        self.node_class[node] = self.current_class
        super().generic_visit(node)

    def visit_Import(self, node: ast.Import) -> None:
        self.node_scope[node] = self.scope
        for alias in node.names:
            self.imports[alias.asname or alias.name.split(".")[0]] = alias.name

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        self.node_scope[node] = self.scope
        module = self._absolute_import_module(node.module, node.level)
        for alias in node.names:
            if alias.name != "*":
                self.imports[alias.asname or alias.name] = f"{module}.{alias.name}"

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self.node_scope[node] = self.scope
        self.node_class[node] = self.current_class
        if self.scope is self.tree:
            self.classes[node.name] = node
        self._scope_stack.append(node)
        self._class_stack.append(node)
        for item in node.body:
            self.visit(item)
        self._class_stack.pop()
        self._scope_stack.pop()

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._visit_function(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self._visit_function(node)

    def visit_Lambda(self, node: ast.Lambda) -> None:
        self.node_scope[node] = self.scope
        self.node_class[node] = self.current_class
        self._scope_stack.append(node)
        self._record_parameters(node, node.args)
        self.visit(node.body)
        self._scope_stack.pop()

    def visit_Assign(self, node: ast.Assign) -> None:
        self.node_scope[node] = self.scope
        self.node_class[node] = self.current_class
        for target in node.targets:
            self._record_assignment(target, node.value, None, node)
        self.generic_visit(node)

    def visit_AnnAssign(self, node: ast.AnnAssign) -> None:
        self.node_scope[node] = self.scope
        self.node_class[node] = self.current_class
        self._record_assignment(node.target, node.value, node.annotation, node)
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        self.node_scope[node] = self.scope
        self.node_class[node] = self.current_class
        self.calls[(node.lineno, node.col_offset + 1)].append(node)
        self.generic_visit(node)

    def call_for(self, line: int, column: int, method: str) -> ast.Call | None:
        candidates = self.calls.get((line, column), ())
        matches = [call for call in candidates if self._call_method(call) == method]
        return matches[0] if len(matches) == 1 else None

    def classify_call(self, call: ast.Call, method: str) -> _Provenance:
        if isinstance(call.func, ast.Attribute):
            receiver = self._resolve_expression(
                call.func.value,
                self.node_scope[call],
                call.lineno,
                call.col_offset,
                frozenset(),
            )
            return self._classify_receiver(receiver, method)
        if isinstance(call.func, ast.Name):
            return self._classify_method_alias(call, method)
        return _Provenance(_UNKNOWN, "computed or unresolved callable")

    def _visit_function(
        self, node: ast.FunctionDef | ast.AsyncFunctionDef
    ) -> None:
        self.node_scope[node] = self.scope
        self.node_class[node] = self.current_class
        for decorator in node.decorator_list:
            self.visit(decorator)
        if node.returns is not None:
            self.visit(node.returns)
        self._scope_stack.append(node)
        self._record_parameters(node, node.args)
        for item in node.body:
            self.visit(item)
        self._scope_stack.pop()

    def _record_parameters(self, scope: ast.AST, arguments: ast.arguments) -> None:
        values = [
            *arguments.posonlyargs,
            *arguments.args,
            *arguments.kwonlyargs,
        ]
        if arguments.vararg is not None:
            values.append(arguments.vararg)
        if arguments.kwarg is not None:
            values.append(arguments.kwarg)
        for argument in values:
            self.parameters[scope][argument.arg] = argument.annotation

    def _record_assignment(
        self,
        target: ast.expr,
        value: ast.expr | None,
        annotation: ast.expr | None,
        node: ast.Assign | ast.AnnAssign,
    ) -> None:
        assignment = _Assignment(node.lineno, node.col_offset, value, annotation)
        if isinstance(target, ast.Name):
            self.assignments[self.scope][target.id].append(assignment)
        elif (
            isinstance(target, ast.Attribute)
            and isinstance(target.value, ast.Name)
            and target.value.id in {"self", "cls"}
            and self.current_class is not None
        ):
            self.attribute_assignments[self.current_class][target.attr].append(assignment)

    def _resolve_expression(
        self,
        expression: ast.expr,
        scope: ast.AST,
        line: int,
        column: int,
        seen: frozenset[tuple[int, str]],
    ) -> _Provenance:
        if isinstance(expression, ast.Name):
            return self._resolve_name(expression.id, scope, line, column, seen)
        if isinstance(expression, ast.Call):
            qualified = self._qualified_name(expression.func)
            if qualified == "sqlite3.connect":
                return _Provenance(
                    _NATIVE_CONNECTION,
                    "exact sqlite3.connect construction",
                    "sqlite3.Connection",
                )
            if isinstance(expression.func, ast.Attribute) and expression.func.attr == "cursor":
                lower = self._resolve_expression(
                    expression.func.value, scope, line, column, seen
                )
                if lower.kind == _NATIVE_CONNECTION:
                    return _Provenance(
                        _NATIVE_CURSOR,
                        "cursor derived from a proven native connection",
                        "sqlite3.Cursor",
                    )
            if qualified is not None:
                role = self._qualified_type_role(qualified, "")
                if role.kind in {_WRAPPER, _NON_SQLITE}:
                    return role
            return _Provenance(_UNKNOWN, "call return is not inferred across functions")
        if isinstance(expression, ast.Attribute):
            if isinstance(expression.value, ast.Name) and expression.value.id in {"self", "cls"}:
                class_node = self._class_for_scope(scope)
                if class_node is not None:
                    return self._resolve_class_attribute(class_node, expression.attr, seen)
            return _Provenance(_UNKNOWN, "member provenance is not locally exact")
        if isinstance(expression, ast.Constant) and expression.value is None:
            return _Provenance(_NON_SQLITE, "receiver is the literal None")
        return _Provenance(_UNKNOWN, "receiver expression has no exact provenance")

    def _resolve_name(
        self,
        name: str,
        scope: ast.AST,
        line: int,
        column: int,
        seen: frozenset[tuple[int, str]],
    ) -> _Provenance:
        marker = (id(scope), name)
        if marker in seen:
            return _Provenance(_UNKNOWN, "receiver alias cycle")
        next_seen = seen | {marker}
        assignments = [
            assignment
            for assignment in self.assignments[scope].get(name, ())
            if (assignment.line, assignment.column) < (line, column)
        ]
        if assignments:
            selected = max(assignments, key=lambda item: (item.line, item.column))
            from_value = (
                self._resolve_expression(
                    selected.value,
                    scope,
                    selected.line,
                    selected.column,
                    next_seen,
                )
                if selected.value is not None
                else _Provenance(_UNKNOWN, "annotation has no assigned value")
            )
            if from_value.kind != _UNKNOWN:
                return from_value
            annotated = self._annotation_provenance(selected.annotation)
            if annotated.kind != _UNKNOWN or annotated.qualified_type is not None:
                return annotated
        if name in self.parameters[scope]:
            annotated = self._annotation_provenance(self.parameters[scope][name])
            if annotated.kind != _UNKNOWN or annotated.qualified_type is not None:
                return annotated
        if scope is not self.tree:
            return self._resolve_name(name, self.tree, line, column, next_seen)
        qualified = self._qualified_name(ast.Name(id=name))
        if qualified is not None:
            return self._qualified_type_role(qualified, "")
        return _Provenance(_UNKNOWN, "name has no local structural receiver proof")

    def _resolve_class_attribute(
        self,
        class_node: ast.ClassDef,
        attribute: str,
        seen: frozenset[tuple[int, str]],
    ) -> _Provenance:
        marker = (id(class_node), attribute)
        if marker in seen:
            return _Provenance(_UNKNOWN, "class member alias cycle")
        writes = self.attribute_assignments[class_node].get(attribute, ())
        if not writes:
            return _Provenance(_UNKNOWN, "class member has no structural assignment proof")
        results: list[_Provenance] = []
        for write in writes:
            scope = (
                self.node_scope.get(write.value, class_node)
                if write.value is not None
                else class_node
            )
            result = (
                self._resolve_expression(
                    write.value,
                    scope,
                    write.line,
                    write.column,
                    seen | {marker},
                )
                if write.value is not None
                else self._annotation_provenance(write.annotation)
            )
            if result.kind == _UNKNOWN and write.annotation is not None:
                result = self._annotation_provenance(write.annotation)
            results.append(result)
        exact = {result.kind for result in results}
        if exact == {_NATIVE_CONNECTION}:
            return _Provenance(
                _NATIVE_CONNECTION,
                "every class-member write is structurally a native connection",
                "sqlite3.Connection",
            )
        if exact == {_NATIVE_CURSOR}:
            return _Provenance(
                _NATIVE_CURSOR,
                "every class-member write is structurally a native cursor",
                "sqlite3.Cursor",
            )
        return _Provenance(_UNKNOWN, "class member has mixed or unresolved writes")

    def _annotation_provenance(self, annotation: ast.expr | None) -> _Provenance:
        if annotation is None:
            return _Provenance(_UNKNOWN, "receiver annotation is absent")
        if isinstance(annotation, ast.Constant) and isinstance(annotation.value, str):
            try:
                annotation = ast.parse(annotation.value, mode="eval").body
            except SyntaxError:
                return _Provenance(_UNKNOWN, "receiver annotation string is unresolved")
        if isinstance(annotation, ast.BinOp) and isinstance(annotation.op, ast.BitOr):
            members = self._union_annotation_members(annotation)
            meaningful = [member for member in members if member.kind != _NON_SQLITE]
            if meaningful and len({member.kind for member in meaningful}) == 1:
                return meaningful[0]
            return _Provenance(_UNKNOWN, "receiver union annotation is not exact")
        qualified = self._qualified_name(annotation)
        if qualified in _SQLITE_NATIVE_TYPES:
            kind = _NATIVE_CONNECTION if qualified == "sqlite3.Connection" else _NATIVE_CURSOR
            return _Provenance(kind, "exact sqlite3 receiver annotation", qualified)
        if qualified in {"builtins.None", "None"} or (
            isinstance(annotation, ast.Constant) and annotation.value is None
        ):
            return _Provenance(_NON_SQLITE, "None annotation member")
        if qualified is not None:
            return self._qualified_type_role(qualified, "")
        return _Provenance(_UNKNOWN, "receiver annotation is unresolved")

    def _union_annotation_members(self, annotation: ast.expr) -> list[_Provenance]:
        if isinstance(annotation, ast.BinOp) and isinstance(annotation.op, ast.BitOr):
            return [
                *self._union_annotation_members(annotation.left),
                *self._union_annotation_members(annotation.right),
            ]
        return [self._annotation_provenance(annotation)]

    def _qualified_type_role(self, qualified: str, method: str) -> _Provenance:
        if qualified in _SQLITE_NATIVE_TYPES:
            kind = _NATIVE_CONNECTION if qualified.endswith("Connection") else _NATIVE_CURSOR
            return _Provenance(kind, "exact sqlite3 type provenance", qualified)
        if qualified in _KNOWN_WRAPPER_TYPES:
            return _Provenance(
                _WRAPPER,
                "exact imported guarded SQLite wrapper type",
                qualified,
            )
        local_prefix = f"{self.module_name}."
        if qualified.startswith(local_prefix):
            class_name = qualified.removeprefix(local_prefix)
            class_node = self.classes.get(class_name)
            if (
                class_node is not None
                and method
                and self._class_method_delegates_to_sqlite(class_node, method)
            ):
                return _Provenance(
                    _WRAPPER,
                    "exact local method delegates through a proven SQLite member",
                    qualified,
                )
        return _Provenance(
            _UNKNOWN,
            "qualified type is not in a proven receiver class",
            qualified,
        )

    def _classify_receiver(self, receiver: _Provenance, method: str) -> _Provenance:
        if receiver.kind in {_NATIVE_CONNECTION, _NATIVE_CURSOR}:
            return receiver
        if receiver.kind == _WRAPPER:
            return receiver
        if receiver.kind == _NON_SQLITE:
            return receiver
        if receiver.qualified_type is not None:
            return self._qualified_type_role(receiver.qualified_type, method)
        return receiver

    def _classify_method_alias(self, call: ast.Call, method: str) -> _Provenance:
        if not isinstance(call.func, ast.Name):
            return _Provenance(_UNKNOWN, "method alias presentation is unresolved")
        assignment = self._latest_module_assignment(call.func.id, call.lineno, call.col_offset)
        if assignment is None or assignment.value is None:
            return _Provenance(_UNKNOWN, "method alias has no exact module binding")
        owner = self._method_alias_owner(assignment.value, method)
        if owner is None:
            return _Provenance(_UNKNOWN, "method alias binding is not structurally exact")
        qualified_owner = self._qualified_name(owner)
        if qualified_owner in _SQLITE_NATIVE_TYPES:
            if not call.args:
                return _Provenance(_UNKNOWN, "unbound native method has no receiver")
            receiver = self._resolve_expression(
                call.args[0],
                self.node_scope[call],
                call.lineno,
                call.col_offset,
                frozenset(),
            )
            expected = (
                _NATIVE_CONNECTION
                if qualified_owner == "sqlite3.Connection"
                else _NATIVE_CURSOR
            )
            if receiver.kind == expected:
                return _Provenance(
                    expected,
                    "exact unbound sqlite3 method and proven first-argument receiver",
                    qualified_owner,
                )
            return _Provenance(
                _UNKNOWN,
                "unbound sqlite3 method receiver is not independently proven",
                qualified_owner,
            )
        if qualified_owner is not None:
            role = self._qualified_type_role(qualified_owner, method)
            if role.kind == _WRAPPER:
                return _Provenance(
                    _WRAPPER,
                    "exact module-level guarded wrapper method capture",
                    qualified_owner,
                )
            if role.kind == _NON_SQLITE:
                return role
        return _Provenance(_UNKNOWN, "method alias owner is not proven")

    def _method_alias_owner(self, expression: ast.expr, method: str) -> ast.expr | None:
        if isinstance(expression, ast.Attribute) and expression.attr == method:
            return expression.value
        if (
            isinstance(expression, ast.Call)
            and self._qualified_name(expression.func) == "builtins.object.__getattribute__"
            and len(expression.args) >= 2
            and isinstance(expression.args[1], ast.Constant)
            and expression.args[1].value == method
        ):
            return expression.args[0]
        return None

    def _latest_module_assignment(
        self, name: str, line: int, column: int
    ) -> _Assignment | None:
        matches = [
            assignment
            for assignment in self.assignments[self.tree].get(name, ())
            if (assignment.line, assignment.column) < (line, column)
        ]
        return max(matches, key=lambda item: (item.line, item.column), default=None)

    def _call_method(self, call: ast.Call) -> str | None:
        if isinstance(call.func, ast.Attribute):
            return call.func.attr
        if isinstance(call.func, ast.Name):
            assignment = self._latest_module_assignment(
                call.func.id, call.lineno, call.col_offset
            )
            if assignment is not None and assignment.value is not None:
                for method in ("exec", "execute", "executemany", "executescript", "cursor"):
                    if self._method_alias_owner(assignment.value, method) is not None:
                        return method
        return None

    def _qualified_name(self, node: ast.AST) -> str | None:
        if isinstance(node, ast.Name):
            if node.id == "object":
                return "builtins.object"
            imported = self.imports.get(node.id)
            if imported is not None:
                return imported
            if node.id in self.classes:
                return f"{self.module_name}.{node.id}"
            if node.id == "None":
                return "None"
            return None
        if isinstance(node, ast.Attribute):
            base = self._qualified_name(node.value)
            return f"{base}.{node.attr}" if base is not None else None
        return None

    def _class_for_scope(self, scope: ast.AST) -> ast.ClassDef | None:
        return self.node_class.get(scope)

    def _class_method_delegates_to_sqlite(
        self, class_node: ast.ClassDef, method: str
    ) -> bool:
        implementations = [
            item
            for item in class_node.body
            if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef))
            and item.name == method
        ]
        if len(implementations) != 1:
            return False
        implementation = implementations[0]
        for node in ast.walk(implementation):
            if not (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == method
                and isinstance(node.func.value, ast.Attribute)
                and isinstance(node.func.value.value, ast.Name)
                and node.func.value.value.id in {"self", "cls"}
            ):
                continue
            receiver = self._resolve_class_attribute(
                class_node,
                node.func.value.attr,
                frozenset(),
            )
            if receiver.kind in {_NATIVE_CONNECTION, _NATIVE_CURSOR}:
                return True
        return False

    def _absolute_import_module(self, module: str | None, level: int) -> str:
        if level == 0:
            return module or ""
        package = self.module_name.split(".")[:-1]
        retained = package[: len(package) - level + 1]
        if module:
            retained.extend(module.split("."))
        return ".".join(retained)


def classify_sqlite_native_python_callsites(
    scanner_report: object,
    repository_root: Path,
) -> SQLiteNativeCallsiteClassificationReport:
    """Classify every Python candidate while retaining unknowns and duplicates."""

    report = _object_mapping(scanner_report, "scanner report")
    raw_callsites = report.get("callsites")
    if type(raw_callsites) is not list:
        raise ValueError("scanner report callsites must be a list")
    python_candidates = [
        _object_mapping(candidate, "scanner callsite")
        for candidate in raw_callsites
        if _optional_str(_object_mapping(candidate, "scanner callsite").get("language"))
        == "python"
    ]
    root = repository_root.resolve()
    analyzers: dict[str, _SourceAnalyzer] = {}
    sortable: list[tuple[tuple[object, ...], dict[str, object]]] = []
    for candidate in python_candidates:
        path = _required_str(candidate, "path")
        line = _required_positive_int(candidate, "line")
        column = _required_positive_int(candidate, "column")
        method = _required_str(candidate, "method")
        sql_origin = _required_str(candidate, "sqlOrigin")
        canonical = json.dumps(
            candidate,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        sortable.append(((path, line, column, method, sql_origin, canonical), candidate))
    sortable.sort(key=lambda item: item[0])

    occurrences: Counter[tuple[str, int, int, str, str]] = Counter()
    classified: list[SQLiteNativeCallsiteClassification] = []
    for _sort_key, candidate in sortable:
        path = _required_str(candidate, "path")
        line = _required_positive_int(candidate, "line")
        column = _required_positive_int(candidate, "column")
        method = _required_str(candidate, "method")
        sql_origin = _required_str(candidate, "sqlOrigin")
        identity_key = (path, line, column, method, sql_origin)
        occurrence = occurrences[identity_key]
        occurrences[identity_key] += 1
        analyzer = analyzers.get(path)
        if analyzer is None:
            source_path = _source_path(root, path)
            module_name = _module_name_for(path)
            analyzer = _SourceAnalyzer(source_path.read_text(encoding="utf-8"), module_name)
            analyzers[path] = analyzer
        call = analyzer.call_for(line, column, method)
        provenance = (
            analyzer.classify_call(call, method)
            if call is not None
            else _Provenance(_UNKNOWN, "scanner identity does not map to one exact AST call")
        )
        category = _category_for(provenance)
        evidence = _object_mapping(candidate.get("sqlEvidence"), "SQL evidence")
        identity = SQLiteNativeCallsiteIdentity(
            path=path,
            line=line,
            column=column,
            method=method,
            sql_origin=sql_origin,
            occurrence=occurrence,
        )
        candidate_id = hashlib.sha256(
            json.dumps(
                {
                    "path": path,
                    "line": line,
                    "column": column,
                    "method": method,
                    "sqlOrigin": sql_origin,
                    "occurrence": occurrence,
                },
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode()
        ).hexdigest()
        classified.append(
            SQLiteNativeCallsiteClassification(
                candidate_id=candidate_id,
                identity=identity,
                category=category,
                reason=provenance.reason,
                scanner_receiver_confidence=_required_str(
                    candidate, "receiverConfidence"
                ),
                scanner_receiver_kind=_required_str(candidate, "receiverKind"),
                sql_status=_required_str(evidence, "status"),
                sql_shape=_required_str(evidence, "shape"),
                sql_sha256=_optional_str(evidence.get("sha256")),
                sql_token=_optional_str(evidence.get("token")),
            )
        )
    counts = Counter(candidate.category for candidate in classified)
    return SQLiteNativeCallsiteClassificationReport(
        candidates=tuple(classified),
        category_counts=tuple((category, counts[category]) for category in _CATEGORIES),
    )


def _category_for(provenance: _Provenance) -> SQLiteNativeCallsiteCategory:
    if provenance.kind in {_NATIVE_CONNECTION, _NATIVE_CURSOR}:
        return "confirmed-native-receiver"
    if provenance.kind == _WRAPPER:
        return "wrapper-guard-or-test-like-production-probe"
    if provenance.kind == _NON_SQLITE:
        return "false-positive"
    return "unknown"


def _source_path(root: Path, relative: str) -> Path:
    relative_path = Path(relative)
    if (
        not relative
        or "\\" in relative
        or relative_path.is_absolute()
        or relative_path.as_posix() != relative
        or any(part in {"", ".", ".."} for part in relative_path.parts)
    ):
        raise ValueError("scanner source path must be repository-relative")
    source = (root / relative_path).resolve()
    try:
        canonical = source.relative_to(root).as_posix()
    except ValueError as error:
        raise ValueError("scanner source path escapes repository root") from error
    if canonical != relative:
        raise ValueError("scanner source path must be canonical")
    if not source.is_file():
        raise ValueError(f"scanner source path is missing: {relative}")
    return source


def _module_name_for(relative: str) -> str:
    path = Path(relative)
    parts = list(path.with_suffix("").parts)
    if "src" in parts:
        parts = parts[parts.index("src") + 1 :]
    return ".".join(parts)


def _object_mapping(value: object, label: str) -> dict[str, object]:
    if type(value) is not dict or not all(type(key) is str for key in value):
        raise ValueError(f"{label} must be an object with string keys")
    return value


def _required_str(value: dict[str, object], key: str) -> str:
    result = value.get(key)
    if type(result) is not str or not result:
        raise ValueError(f"scanner {key} must be a non-empty string")
    return result


def _optional_str(value: object) -> str | None:
    if value is None:
        return None
    if type(value) is not str:
        raise ValueError("optional scanner string field has an invalid type")
    return value


def _required_positive_int(value: dict[str, object], key: str) -> int:
    result = value.get(key)
    if type(result) is not int or result < 1:
        raise ValueError(f"scanner {key} must be a positive integer")
    return result
