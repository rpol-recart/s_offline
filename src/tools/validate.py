import json
import sys
from pathlib import Path

from src.models.graph import EdgeType, NodeType, SpecGraph


def validate_graph(graph_path: str) -> None:
    path = Path(graph_path)
    if not path.exists():
        print(f"Error: file not found: {graph_path}", file=sys.stderr)
        sys.exit(1)

    with open(path, encoding="utf-8") as f:
        raw = json.load(f)

    try:
        graph = SpecGraph.model_validate(raw)
    except Exception as e:
        print(f"VALIDATION ERROR: Invalid graph structure: {e}")
        sys.exit(1)

    issues: list[dict[str, str]] = []

    orphans = graph.get_orphan_nodes()
    for node_id in orphans:
        issues.append(
            {
                "severity": "warning",
                "type": "orphan_node",
                "node": node_id,
                "message": (
                    f"Node '{node_id}' has no edges (type: {graph.nodes[node_id].type.value})"
                ),
            }
        )

    cycles = graph.find_circular_dependencies()
    for cycle in cycles:
        issues.append(
            {
                "severity": "critical",
                "type": "circular_dependency",
                "nodes": " -> ".join(cycle),
                "message": f"Circular dependency detected: {' -> '.join(cycle)}",
            }
        )

    reqs = graph.get_nodes_by_type(NodeType.REQUIREMENT)
    tasks = graph.get_nodes_by_type(NodeType.TASK)

    for req in reqs:
        impl_edges = graph.get_edges_from(req.id, EdgeType.IMPLEMENTS)
        if not impl_edges:
            reverse_impl = graph.get_edges_to(req.id, EdgeType.IMPLEMENTS)
            if not reverse_impl:
                issues.append(
                    {
                        "severity": "major",
                        "type": "uncovered_requirement",
                        "node": req.id,
                        "message": f"Requirement '{req.id}' has no implementing task",
                    }
                )

    for task in tasks:
        has_estimate = bool(task.data.get("estimate"))
        if not has_estimate:
            issues.append(
                {
                    "severity": "minor",
                    "type": "missing_estimate",
                    "node": task.id,
                    "message": f"Task '{task.id}' has no time estimate",
                }
            )

    unresolved = graph.unresolved_uncertainties()
    for unc in unresolved:
        issues.append(
            {
                "severity": "warning" if unc.severity == "minor" else "major",
                "type": "unresolved_uncertainty",
                "node": unc.id,
                "message": f"Uncertainty '{unc.id}' unresolved: {unc.question[:80]}",
            }
        )

    stats = graph.statistics()
    print("=== Graph Statistics ===")
    for key, val in sorted(stats.items()):
        print(f"  {key}: {val}")

    print(f"\n=== Issues Found: {len(issues)} ===")
    critical = [i for i in issues if i["severity"] == "critical"]
    major = [i for i in issues if i["severity"] == "major"]
    minor = [i for i in issues if i["severity"] in ("minor", "warning")]

    print(f"  Critical: {len(critical)}")
    print(f"  Major: {len(major)}")
    print(f"  Minor/Warning: {len(minor)}")

    if issues:
        print("\n=== Details ===")
        for issue in issues:
            print(f"  [{issue['severity'].upper()}] {issue['type']}: {issue['message']}")

    if critical:
        print("\nVERDICT: FAIL — critical issues found")
        sys.exit(1)
    elif major:
        print("\nVERDICT: NEEDS_FIXES — major issues found")
        sys.exit(0)
    else:
        print("\nVERDICT: PASS — no critical or major issues")
        sys.exit(0)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python -m src.tools.validate <graph.json>", file=sys.stderr)
        sys.exit(1)
    validate_graph(sys.argv[1])
