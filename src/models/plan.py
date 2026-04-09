from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class Estimate(BaseModel):
    optimistic: str = ""
    likely: str = ""
    pessimistic: str = ""
    expected: str = ""

    def pert_expected(self) -> str:
        return self.expected


class ResourceNeed(BaseModel):
    role: str
    effort: str = ""
    count: int = 1


class PlanWave(BaseModel):
    name: str
    tasks: list[str] = Field(default_factory=list)
    duration: str = ""
    resources: list[ResourceNeed] = Field(default_factory=list)
    parallel: bool = True


class ExecutionPlan(BaseModel):
    waves: list[PlanWave] = Field(default_factory=list)
    critical_path: list[str] = Field(default_factory=list)
    total_duration: str = ""
    total_effort: str = ""
    peak_team_size: int = 0
    milestones: list[dict[str, Any]] = Field(default_factory=list)
    equipment_needs: list[dict[str, Any]] = Field(default_factory=list)
    resource_bottlenecks: list[str] = Field(default_factory=list)

    model_config = {"extra": "forbid"}
