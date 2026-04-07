---
name: yolo-detection
description: "YOLO object detection — Ultralytics API, training, inference, export, deployment"
---

# YOLO Detection Skill

## When to Use

When implementing object detection, segmentation, or pose estimation with YOLO models (Ultralytics ecosystem).

## Model Selection

| Model | Size | mAP | Speed (ms) | Use Case |
|-------|------|-----|-----------|----------|
| YOLOv8n | 3.2M | 37.3 | 1.2 | Edge, real-time |
| YOLOv8s | 11.2M | 44.9 | 2.1 | Balanced |
| YOLOv8m | 25.9M | 50.2 | 4.7 | General purpose |
| YOLOv8l | 43.7M | 52.9 | 7.1 | High accuracy |
| YOLOv8x | 68.2M | 53.9 | 11.1 | Maximum accuracy |
| YOLO11n-x | varies | improved | varies | Latest generation |

Task variants: `-det` (detection), `-seg` (segmentation), `-pose` (pose), `-cls` (classification), `-obb` (oriented bbox)

## Inference

```python
from ultralytics import YOLO

# Load model
model = YOLO("yolov8n.pt")       # Pretrained
model = YOLO("best.pt")           # Custom trained
model = YOLO("model.engine")      # TensorRT

# Predict
results = model.predict(
    source="image.jpg",            # image, directory, video, URL, 0 (webcam)
    conf=0.25,                     # Confidence threshold
    iou=0.45,                      # NMS IoU threshold
    classes=[0, 2, 5],             # Filter: person, car, bus
    device="cuda:0",               # GPU device
    imgsz=640,                     # Input size
    save=True,                     # Save annotated images
    save_txt=True,                 # Save labels
    stream=True,                   # Generator for video (memory efficient)
)

# Process results
for result in results:
    boxes = result.boxes
    for box in boxes:
        xyxy = box.xyxy[0].tolist()       # [x1, y1, x2, y2]
        conf = box.conf[0].item()          # Confidence
        cls_id = int(box.cls[0].item())    # Class ID
        cls_name = result.names[cls_id]    # Class name

        print(f"{cls_name}: {conf:.2f} at {xyxy}")

    # Segmentation masks (if -seg model)
    if result.masks is not None:
        masks = result.masks.data  # (N, H, W) tensor

    # Pose keypoints (if -pose model)
    if result.keypoints is not None:
        keypoints = result.keypoints.xy  # (N, 17, 2)
```

## Training

```python
from ultralytics import YOLO

model = YOLO("yolov8n.pt")  # Start from pretrained

# Train
results = model.train(
    data="dataset.yaml",           # Dataset config
    epochs=100,
    imgsz=640,
    batch=16,                      # Batch size (-1 for auto)
    device="0",                    # GPU
    workers=8,
    patience=20,                   # Early stopping
    save_period=10,                # Save every N epochs
    project="runs/detect",
    name="experiment1",

    # Augmentation
    hsv_h=0.015,
    hsv_s=0.7,
    hsv_v=0.4,
    degrees=10.0,
    translate=0.1,
    scale=0.5,
    fliplr=0.5,
    mosaic=1.0,
    mixup=0.1,

    # Hyperparameters
    lr0=0.01,
    lrf=0.01,
    momentum=0.937,
    weight_decay=0.0005,
    warmup_epochs=3.0,
)

# Validate
metrics = model.val()
print(f"mAP50: {metrics.box.map50:.4f}")
print(f"mAP50-95: {metrics.box.map:.4f}")
```

### Dataset YAML

```yaml
# dataset.yaml
path: /data/dataset
train: images/train
val: images/val
test: images/test

names:
  0: person
  1: car
  2: truck
  3: bicycle

# Optional: download script
# download: https://example.com/dataset.zip
```

### Dataset Directory Structure

```
dataset/
├── images/
│   ├── train/
│   │   ├── img001.jpg
│   │   └── ...
│   └── val/
│       ├── img100.jpg
│       └── ...
└── labels/
    ├── train/
    │   ├── img001.txt    # class_id cx cy w h (normalized)
    │   └── ...
    └── val/
        ├── img100.txt
        └── ...
```

Label format (per line): `class_id center_x center_y width height` (all normalized 0-1)

## Export

```python
model = YOLO("best.pt")

# ONNX (cross-platform)
model.export(format="onnx", imgsz=640, dynamic=True, simplify=True)

# TensorRT (NVIDIA GPU inference)
model.export(format="engine", imgsz=640, half=True, device=0)

# OpenVINO (Intel)
model.export(format="openvino", imgsz=640, half=True)

# CoreML (Apple)
model.export(format="coreml", imgsz=640)

# NCNN (mobile)
model.export(format="ncnn", imgsz=640)
```

## Video Processing

```python
import cv2
from ultralytics import YOLO

model = YOLO("yolov8n.pt")

cap = cv2.VideoCapture("video.mp4")  # or RTSP URL or 0 for webcam
fps = cap.get(cv2.CAP_PROP_FPS)
w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

writer = cv2.VideoWriter("output.mp4", cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))

while cap.isOpened():
    ret, frame = cap.read()
    if not ret:
        break

    results = model.predict(frame, conf=0.25, verbose=False)
    annotated = results[0].plot()

    writer.write(annotated)

cap.release()
writer.release()
```

## Integration with DeepStream

Export YOLO to ONNX/TensorRT, then use in DeepStream config:

```ini
[property]
onnx-file=yolov8n.onnx
model-engine-file=yolov8n.engine
labelfile-path=labels.txt
num-detected-classes=80
```

Custom parser required for YOLO output format in DeepStream — use `nvdsinfer_custom_impl_Yolo`.

## Best Practices

1. **Start small** — use `yolov8n` first, upgrade model size only if accuracy is insufficient
2. **Freeze backbone** — for small datasets, freeze early layers: `model.train(freeze=10)`
3. **Augmentation** — enable mosaic and mixup for better generalization
4. **Export to TensorRT** — 3-5x faster inference with `half=True`
5. **Stream mode** — use `stream=True` for video to avoid OOM
6. **Class filtering** — use `classes=[0, 2]` to detect only needed classes
7. **Confidence tuning** — start at 0.25, increase for precision, decrease for recall
