from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, model_validator


class NodeType(str, Enum):
    REQUIREMENT = "requirement"
    TASK = "task"
    RISK = "risk"
    UNCERTAINTY = "uncertainty"
    RESOURCE = "resource"
    TECHNOLOGY = "technology"
    EQUIPMENT = "equipment"
    CONSTRAINT = "constraint"
    ASSUMPTION = "assumption"
    MILESTONE = "milestone"
    DATASET = "dataset"
    MODEL = "model"
    EXPERIMENT = "experiment"
    METRIC = "metric"
    PIPELINE = "pipeline"
    COMPUTE = "compute"


class EdgeType(str, Enum):
    DEPENDS_ON = "depends_on"
    IMPLEMENTS = "implements"
    REQUIRES = "requires"
    GENERATES_RISK = "generates_risk"
    MITIGATES = "mitigates"
    CONFLICTS_WITH = "conflicts_with"
    CONSTRAINS = "constrains"
    ASSUMES = "assumes"
    HAS_UNCERTAINTY = "has_uncertainty"
    TRAINED_ON = "trained_on"
    EVALUATED_BY = "evaluated_by"
    PROCESSES = "processes"
    PRODUCES = "produces"
    DEPLOYS_TO = "deploys_to"
    AUGMENTED_BY = "augmented_by"
    FINE_TUNED_FROM = "fine_tuned_from"
    BASELINES_AGAINST = "baselines_against"
    REQUIRES_GPU_HOURS = "requires_gpu_hours"


class GraphNode(BaseModel):
    id: str = Field(default="", pattern=r"^[a-z]+-\d{3}$|^[a-z]+-\d{3,}$")
    type: NodeType
    data: dict[str, Any] = Field(default_factory=dict)

    model_config = {"extra": "forbid"}


class GraphEdge(BaseModel):
    from_: str = Field(alias="from")
    to: str
    type: EdgeType
    label: str | None = None

    model_config = {"extra": "forbid", "populate_by_name": True}


class UncertaintyRecord(BaseModel):
    id: str = Field(pattern=r"^unc-\d{3}$")
    question: str
    resolved: bool = False
    answer: str | None = None
    severity: str = "minor"
    context_node: str | None = None


class GraphMeta(BaseModel):
    source: str = ""
    created: str = ""
    version: int = 1
    doc_slug: str = ""


class SpecGraph(BaseModel):
    meta: GraphMeta = Field(default_factory=GraphMeta)
    nodes: dict[str, GraphNode] = Field(default_factory=dict)
    edges: list[GraphEdge] = Field(default_factory=list)
    uncertainties: list[UncertaintyRecord] = Field(default_factory=list)

    model_config = {"extra": "forbid"}

    @model_validator(mode="before")
    @classmethod
    def _inject_node_ids(cls, data: Any) -> Any:
        if isinstance(data, dict) and "nodes" in data:
            nodes = data["nodes"]
            if isinstance(nodes, dict):
                injected: dict[str, dict[str, Any]] = {}
                for key, val in nodes.items():
                    if isinstance(val, dict):
                        val_copy = dict(val)
                        val_copy.setdefault("id", key)
                        injected[key] = val_copy
                    else:
                        injected[key] = val
                data = {**data, "nodes": injected}
        return data

    def add_node(self, node: GraphNode) -> None:
        self.nodes[node.id] = node

    def add_edge(self, edge: GraphEdge) -> None:
        self.edges.append(edge)

    def add_uncertainty(self, unc: UncertaintyRecord) -> None:
        self.uncertainties.append(unc)

    def get_nodes_by_type(self, node_type: NodeType) -> list[GraphNode]:
        return [n for n in self.nodes.values() if n.type == node_type]

    def get_edges_from(self, node_id: str, edge_type: EdgeType | None = None) -> list[GraphEdge]:
        return [
            e
            for e in self.edges
            if e.from_ == node_id and (edge_type is None or e.type == edge_type)
        ]

    def get_edges_to(self, node_id: str, edge_type: EdgeType | None = None) -> list[GraphEdge]:
        return [
            e for e in self.edges if e.to == node_id and (edge_type is None or e.type == edge_type)
        ]

    def get_orphan_nodes(self) -> list[str]:
        connected = set()
        for e in self.edges:
            connected.add(e.from_)
            connected.add(e.to)
        return [nid for nid in self.nodes if nid not in connected]

    def find_circular_dependencies(self) -> list[list[str]]:
        dep_edges = [e for e in self.edges if e.type == EdgeType.DEPENDS_ON]
        adj: dict[str, list[str]] = {}
        for e in dep_edges:
            adj.setdefault(e.from_, []).append(e.to)

        visited: set[str] = set()
        path: set[str] = set()
        cycles: list[list[str]] = []

        def dfs(node: str, current_path: list[str]) -> None:
            if node in path:
                cycle_start = current_path.index(node)
                cycles.append(current_path[cycle_start:] + [node])
                return
            if node in visited:
                return
            visited.add(node)
            path.add(node)
            current_path.append(node)
            for neighbor in adj.get(node, []):
                dfs(neighbor, current_path)
            current_path.pop()
            path.discard(node)

        for n in self.nodes:
            if n not in visited:
                dfs(n, [])

        return cycles

    def unresolved_uncertainties(self) -> list[UncertaintyRecord]:
        return [u for u in self.uncertainties if not u.resolved]

    def critical_unresolved(self) -> list[UncertaintyRecord]:
        return [u for u in self.unresolved_uncertainties() if u.severity == "critical"]

    def statistics(self) -> dict[str, int]:
        stats: dict[str, int] = {}
        for nt in NodeType:
            stats[f"{nt.value}_count"] = len(self.get_nodes_by_type(nt))
        stats["edge_count"] = len(self.edges)
        stats["uncertainty_count"] = len(self.uncertainties)
        stats["unresolved_count"] = len(self.unresolved_uncertainties())
        return stats
