import json
import sys
from pathlib import Path

from src.models.graph import EdgeType, NodeType, SpecGraph


def graph_to_mermaid(graph: SpecGraph) -> str:
    lines: list[str] = ["graph TD"]

    type_styles: dict[NodeType, str] = {
        NodeType.REQUIREMENT: "req",
        NodeType.TASK: "task",
        NodeType.RISK: "risk",
        NodeType.UNCERTAINTY: "unc",
        NodeType.RESOURCE: "res",
        NodeType.TECHNOLOGY: "tech",
        NodeType.EQUIPMENT: "equip",
        NodeType.CONSTRAINT: "constr",
        NodeType.ASSUMPTION: "assump",
        NodeType.MILESTONE: "ms",
        NodeType.DATASET: "ds",
        NodeType.MODEL: "model",
        NodeType.EXPERIMENT: "exp",
        NodeType.METRIC: "met",
        NodeType.PIPELINE: "pipe",
        NodeType.COMPUTE: "comp",
    }

    type_shapes: dict[NodeType, tuple[str, str]] = {
        NodeType.REQUIREMENT: ("[", "]"),
        NodeType.TASK: ("(", ")"),
        NodeType.RISK: ("{{", "}}"),
        NodeType.UNCERTAINTY: ("{", "}"),
        NodeType.RESOURCE: ("([", "])"),
        NodeType.TECHNOLOGY: ("[[", "]]"),
        NodeType.EQUIPMENT: ("[/", "/]"),
        NodeType.CONSTRAINT: (">", "]"),
        NodeType.ASSUMPTION: ("~", "~"),
        NodeType.MILESTONE: (">>", "]"),
        NodeType.DATASET: ("([", "])"),
        NodeType.MODEL: ("[[", "]]"),
        NodeType.EXPERIMENT: ("(", ")"),
        NodeType.METRIC: ("{{", "}}"),
        NodeType.PIPELINE: ("[/", "/]"),
        NodeType.COMPUTE: ("[\\", "\\]"),
    }

    for node_id, node in graph.nodes.items():
        prefix = type_styles.get(node.type, "node")
        label = node.data.get("text", node.data.get("title", node.data.get("description", node_id)))
        if isinstance(label, str) and len(label) > 50:
            label = label[:47] + "..."
        label = label.replace('"', "'").replace("\n", " ")
        left, right = type_shapes.get(node.type, ("[", "]"))
        lines.append(f'    {prefix}_{node_id}{left}"{label}"{right}')

    edge_arrows: dict[EdgeType, str] = {
        EdgeType.DEPENDS_ON: "-->",
        EdgeType.IMPLEMENTS: "==>",
        EdgeType.REQUIRES: "-.->",
        EdgeType.GENERATES_RISK: "--x",
        EdgeType.MITIGATES: "--|mitigates|-->",
        EdgeType.CONFLICTS_WITH: "--|CONFLICTS|-->",
        EdgeType.CONSTRAINS: "--|constrains|-->",
        EdgeType.ASSUMES: "-.->|assumes|",
        EdgeType.HAS_UNCERTAINTY: "--|uncertain|-->",
        EdgeType.TRAINED_ON: "==>|trained_on|",
        EdgeType.EVALUATED_BY: "--|eval_by|-->",
        EdgeType.PROCESSES: "-.->|processes|",
        EdgeType.PRODUCES: "==>|produces|",
        EdgeType.DEPLOYS_TO: "--|deploys|-->",
        EdgeType.AUGMENTED_BY: "-.->|augmented|",
        EdgeType.FINE_TUNED_FROM: "==>|fine_tune|",
        EdgeType.BASELINES_AGAINST: "--|vs_baseline|-->",
        EdgeType.REQUIRES_GPU_HOURS: "-.->|GPU_hrs|",
    }

    for edge in graph.edges:
        from_prefix = (
            type_styles.get(graph.nodes[edge.from_].type, "node")
            if edge.from_ in graph.nodes
            else "node"
        )
        to_prefix = (
            type_styles.get(graph.nodes[edge.to].type, "node") if edge.to in graph.nodes else "node"
        )
        arrow = edge_arrows.get(edge.type, "-->")
        label_part = f"|{edge.label}|" if edge.label else ""
        lines.append(f"    {from_prefix}_{edge.from_} {arrow}{label_part} {to_prefix}_{edge.to}")

    for unc in graph.unresolved_uncertainties():
        ctx = unc.context_node or ""
        if ctx and ctx in graph.nodes:
            ctx_prefix = type_styles.get(graph.nodes[ctx].type, "node")
            lines.append(f"    {ctx_prefix}_{ctx} --|❓ {unc.question[:30]}|--> unc_{unc.id}")

    lines.append("")
    return "\n".join(lines)


def visualize(graph_path: str, output_path: str | None = None) -> None:
    path = Path(graph_path)
    if not path.exists():
        print(f"Error: file not found: {graph_path}", file=sys.stderr)
        sys.exit(1)

    with open(path, encoding="utf-8") as f:
        raw = json.load(f)

    graph = SpecGraph.model_validate(raw)
    mermaid = graph_to_mermaid(graph)

    if output_path:
        out = Path(output_path)
        out.write_text(f"```mermaid\n{mermaid}```\n", encoding="utf-8")
        print(f"Mermaid diagram written to: {output_path}")
    else:
        print(f"```mermaid\n{mermaid}```")


if __name__ == "__main__":
    if len(sys.argv) < 2 or len(sys.argv) > 3:
        print(
            "Usage: python -m src.tools.visualize <graph.json> [output.md]",
            file=sys.stderr,
        )
        sys.exit(1)
    output = sys.argv[2] if len(sys.argv) == 3 else None
    visualize(sys.argv[1], output)
