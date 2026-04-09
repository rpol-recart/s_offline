from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class RequirementType(str, Enum):
    FUNCTIONAL = "functional"
    NON_FUNCTIONAL = "non_functional"


class Requirement(BaseModel):
    id: str = Field(pattern=r"^req-\d{3}$")
    text: str
    type: RequirementType = RequirementType.FUNCTIONAL
    priority: str = "medium"
    status: str = "identified"
    section: str | None = None

    def to_graph_data(self) -> dict[str, Any]:
        return self.model_dump(exclude={"id"})


class TaskComplexity(str, Enum):
    SIMPLE = "simple"
    MEDIUM = "medium"
    COMPLEX = "complex"


class TaskMethod(str, Enum):
    IMPLEMENT = "implement"
    CONFIGURE = "configure"
    INTEGRATE = "integrate"
    MIGRATE = "migrate"
    TEST = "test"
    DOCUMENT = "document"
    RESEARCH = "research"
    TRAIN = "train"
    FINE_TUNE = "fine_tune"
    EVALUATE = "evaluate"
    ANNOTATE = "annotate"
    DEPLOY_INFERENCE = "deploy_inference"
    COLLECT_DATA = "collect_data"
    EDA = "eda"
    FEATURE_ENGINEERING = "feature_engineering"


class Task(BaseModel):
    id: str = Field(pattern=r"^task-\d{3}$")
    title: str
    description: str = ""
    complexity: TaskComplexity = TaskComplexity.MEDIUM
    method: TaskMethod = TaskMethod.IMPLEMENT
    deliverable: str = ""
    implements: list[str] = Field(default_factory=list)

    def to_graph_data(self) -> dict[str, Any]:
        return self.model_dump(exclude={"id"})


class RiskImpact(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class Risk(BaseModel):
    id: str = Field(pattern=r"^risk-\d{3}$")
    description: str
    probability: float = Field(ge=0.0, le=1.0, default=0.5)
    impact: RiskImpact = RiskImpact.MEDIUM
    category: str = "technical"
    mitigation: str = ""
    mitigation_task: str | None = None

    def to_graph_data(self) -> dict[str, Any]:
        return self.model_dump(exclude={"id"})


class UncertaintySeverity(str, Enum):
    CRITICAL = "critical"
    MINOR = "minor"


class Uncertainty(BaseModel):
    id: str = Field(pattern=r"^unc-\d{3}$")
    question: str
    severity: UncertaintySeverity = UncertaintySeverity.MINOR
    context_node: str | None = None
    resolved: bool = False
    answer: str | None = None

    def to_graph_data(self) -> dict[str, Any]:
        return self.model_dump(exclude={"id"})


class ResourceType(str, Enum):
    PERSON = "person"
    TEAM = "team"
    SERVICE = "service"


class Resource(BaseModel):
    id: str = Field(pattern=r"^res-\d{3}$")
    name: str
    type: ResourceType = ResourceType.PERSON
    skills: list[str] = Field(default_factory=list)
    availability: str = "full-time"

    def to_graph_data(self) -> dict[str, Any]:
        return self.model_dump(exclude={"id"})


class Technology(BaseModel):
    id: str = Field(pattern=r"^tech-\d{3}$")
    name: str
    version: str = ""
    rationale: str = ""
    alternatives: list[str] = Field(default_factory=list)

    def to_graph_data(self) -> dict[str, Any]:
        return self.model_dump(exclude={"id"})


class EquipmentAlternative(BaseModel):
    name: str
    pros: list[str] = Field(default_factory=list)
    cons: list[str] = Field(default_factory=list)
    cost: str = ""


class Equipment(BaseModel):
    id: str = Field(pattern=r"^equip-\d{3}$")
    name: str
    specs: dict[str, str] = Field(default_factory=dict)
    cost_range: dict[str, str] = Field(default_factory=dict)
    vendor: str = ""
    lead_time: str = ""
    rationale: str = ""
    alternatives: list[EquipmentAlternative] = Field(default_factory=list)
    needs_user_approval: bool = False

    def to_graph_data(self) -> dict[str, Any]:
        return self.model_dump(exclude={"id"})


class ConstraintType(str, Enum):
    BUDGET = "budget"
    TIME = "time"
    REGULATORY = "regulatory"
    TECHNICAL = "technical"
    ORGANIZATIONAL = "organizational"


class Constraint(BaseModel):
    id: str = Field(pattern=r"^constr-\d{3}$")
    type: ConstraintType = ConstraintType.TECHNICAL
    value: str = ""
    description: str = ""

    def to_graph_data(self) -> dict[str, Any]:
        return self.model_dump(exclude={"id"})


class Assumption(BaseModel):
    id: str = Field(pattern=r"^assump-\d{3}$")
    text: str
    validated: bool = False

    def to_graph_data(self) -> dict[str, Any]:
        return self.model_dump(exclude={"id"})


class Milestone(BaseModel):
    id: str = Field(pattern=r"^ms-\d{3}$")
    name: str
    deadline: str = ""
    deliverables: list[str] = Field(default_factory=list)

    def to_graph_data(self) -> dict[str, Any]:
        return self.model_dump(exclude={"id"})


class DatasetType(str, Enum):
    IMAGE = "image"
    VIDEO = "video"
    TABULAR = "tabular"
    TEXT = "text"
    AUDIO = "audio"
    POINTCLOUD = "pointcloud"
    MULTIMODAL = "multimodal"


class AnnotationType(str, Enum):
    BBOX = "bounding_box"
    SEGMENTATION = "segmentation"
    KEYPOINT = "keypoint"
    CLASSIFICATION = "classification"
    DETECTION = "detection"
    NER = "named_entity_recognition"
    CUSTOM = "custom"


class Dataset(BaseModel):
    id: str = Field(pattern=r"^ds-\d{3}$")
    name: str
    type: DatasetType = DatasetType.IMAGE
    size: str = ""
    source: str = ""
    annotation_type: AnnotationType | None = None
    annotation_status: str = "not_started"
    privacy: str = "internal"
    quality_notes: str = ""
    preprocessing: list[str] = Field(default_factory=list)
    augmentation: list[str] = Field(default_factory=list)
    license: str = ""

    def to_graph_data(self) -> dict[str, Any]:
        return self.model_dump(exclude={"id"})


class ModelArchitecture(str, Enum):
    CNN = "cnn"
    RESNET = "resnet"
    EFFICIENTNET = "efficientnet"
    VIT = "vision_transformer"
    YOLO = "yolo"
    DETR = "detr"
    SAM = "sam"
    TRANSFORMER = "transformer"
    BERT = "bert"
    GPT = "gpt"
    LLAMA = "llama"
    DIFFUSION = "diffusion"
    UNET = "unet"
    CUSTOM = "custom"


class ModelFramework(str, Enum):
    PYTORCH = "pytorch"
    TENSORFLOW = "tensorflow"
    JAX = "jax"
    HUGGINGFACE = "huggingface"
    ONNX = "onnx"
    OPENVINO = "openvino"
    TENSORRT = "tensorrt"


class MLModel(BaseModel):
    id: str = Field(pattern=r"^model-\d{3}$")
    name: str
    architecture: ModelArchitecture = ModelArchitecture.CUSTOM
    framework: ModelFramework = ModelFramework.PYTORCH
    pretrained_source: str = ""
    input_format: str = ""
    output_format: str = ""
    hyperparameters: dict[str, Any] = Field(default_factory=dict)
    gpu_memory_required: str = ""
    inference_latency_target: str = ""

    def to_graph_data(self) -> dict[str, Any]:
        return self.model_dump(exclude={"id"})


class MetricType(str, Enum):
    ACCURACY = "accuracy"
    PRECISION = "precision"
    RECALL = "recall"
    F1 = "f1"
    MAP = "mAP"
    IOU = "IoU"
    AUC = "AUC"
    LOSS = "loss"
    PERPLEXITY = "perplexity"
    BLEU = "bleu"
    CUSTOM = "custom"


class Metric(BaseModel):
    id: str = Field(pattern=r"^metric-\d{3}$")
    name: str
    type: MetricType = MetricType.CUSTOM
    target_value: str = ""
    baseline_value: str = ""
    description: str = ""

    def to_graph_data(self) -> dict[str, Any]:
        return self.model_dump(exclude={"id"})


class Experiment(BaseModel):
    id: str = Field(pattern=r"^exp-\d{3}$")
    name: str
    hypothesis: str = ""
    status: str = "planned"
    baseline_model: str = ""
    gpu_hours_estimated: float = 0
    gpu_hours_actual: float = 0
    results_summary: str = ""
    reproducibility_notes: str = ""

    def to_graph_data(self) -> dict[str, Any]:
        return self.model_dump(exclude={"id"})


class PipelineStage(str, Enum):
    INGEST = "ingest"
    VALIDATE = "validate"
    PREPROCESS = "preprocess"
    AUGMENT = "augment"
    TRAIN = "train"
    EVALUATE = "evaluate"
    EXPORT = "export"
    DEPLOY = "deploy"


class Pipeline(BaseModel):
    id: str = Field(pattern=r"^pipe-\d{3}$")
    name: str
    stages: list[PipelineStage] = Field(default_factory=list)
    tools: list[str] = Field(default_factory=list)
    automation_level: str = "semi_automated"

    def to_graph_data(self) -> dict[str, Any]:
        return self.model_dump(exclude={"id"})


class ComputeType(str, Enum):
    GPU = "gpu"
    TPU = "tpu"
    CPU = "cpu"
    CLOUD_GPU = "cloud_gpu"
    EDGE = "edge"


class Compute(BaseModel):
    id: str = Field(pattern=r"^comp-\d{3}$")
    name: str
    type: ComputeType = ComputeType.GPU
    specs: str = ""
    hours_estimated: float = 0
    cost_per_hour: str = ""
    total_cost_estimated: str = ""
    provider: str = ""
    availability: str = "on_demand"

    def to_graph_data(self) -> dict[str, Any]:
        return self.model_dump(exclude={"id"})
