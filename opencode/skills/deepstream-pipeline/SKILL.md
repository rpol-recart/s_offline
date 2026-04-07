---
name: deepstream-pipeline
description: "NVIDIA DeepStream 6.3/8 pipeline configuration — inference, tracking, analytics"
---

# DeepStream Pipeline Skill

## When to Use

When building real-time video analytics pipelines with NVIDIA DeepStream — object detection, tracking, classification, and custom analytics on video streams.

## DeepStream Versions

| Version | Platform | GStreamer | Python Bindings | Key Difference |
|---------|----------|-----------|----------------|----------------|
| 6.3 | Jetson (JetPack 5.x) | 1.16 | pyds 1.1.8 | Edge deployment, ARM |
| 8.0 | dGPU (x86_64) | 1.20+ | pyds 1.2+ | Server deployment, new API |

## Pipeline Architecture

```
source → decode → streammux → nvinfer → nvtracker → nvdsanalytics → nvosd → sink
  │                              │           │              │
  │                          (detector)   (tracker)    (line crossing,
  │                                                    ROI counting)
  └── filesrc / uridecodebin / nvarguscamerasrc / rtsp
```

## Configuration Files

### Main Pipeline Config (`deepstream_app_config.txt`)

```ini
[application]
enable-perf-measurement=1
perf-measurement-interval-sec=5

[tiled-display]
enable=1
rows=2
columns=2
width=1920
height=1080

[source0]
enable=1
type=3                    # 3=URI, 4=RTSP, 5=CSI camera
uri=file:///path/to/video.mp4
num-sources=1
gpu-id=0

[streammux]
batch-size=4
batched-push-timeout=40000
width=1920
height=1080

[primary-gie]
enable=1
gpu-id=0
gie-unique-id=1
config-file=config_infer_primary.txt
# model-engine-file=model.engine  # Pre-built TensorRT engine

[tracker]
enable=1
tracker-width=640
tracker-height=480
ll-lib-file=/opt/nvidia/deepstream/deepstream/lib/libnvds_nvmultiobjecttracker.so
ll-config-file=config_tracker_NvDCF_perf.yml
gpu-id=0

[sink0]
enable=1
type=2                    # 1=Fakesink, 2=EGL, 3=File, 4=RTSP
sync=0

[osd]
enable=1
text-size=15
border-width=2
```

### Inference Config (`config_infer_primary.txt`)

```ini
[property]
gpu-id=0
net-scale-factor=0.00392156862745098   # 1/255
model-color-format=0                    # 0=RGB
# YOLO with custom parser
custom-network-config=yolov8n.cfg
model-file=yolov8n.weights
# Or ONNX
onnx-file=yolov8n.onnx
model-engine-file=yolov8n.engine
labelfile-path=labels.txt
batch-size=4
network-mode=2            # 0=FP32, 1=INT8, 2=FP16
num-detected-classes=80
interval=0                # Infer every frame (0), skip frames (1,2,...)
process-mode=1            # 1=Primary, 2=Secondary
network-type=0            # 0=Detector, 1=Classifier, 2=Segmentation

[class-attrs-all]
pre-cluster-threshold=0.25
nms-iou-threshold=0.45
```

### Tracker Config (`config_tracker_NvDCF_perf.yml`)

```yaml
%YAML:1.0
BaseConfig:
  minDetectorConfidence: 0.2
  minTrackerConfidence: 0.5
  minMatchingScore4Overall: 0.3

TargetManagement:
  maxTargetsPerStream: 150
  minIouDiff4NewTarget: 0.5

TrajectoryManagement:
  useUniqueID: 1
```

## Python Custom Logic (pyds)

```python
import gi
gi.require_version('Gst', '1.0')
from gi.repository import Gst, GLib
import pyds

def osd_sink_pad_buffer_probe(pad, info, u_data):
    gst_buffer = info.get_buffer()
    batch_meta = pyds.gst_buffer_get_nvds_batch_meta(hash(gst_buffer))

    l_frame = batch_meta.frame_meta_list
    while l_frame is not None:
        frame_meta = pyds.NvDsFrameMeta.cast(l_frame.data)

        l_obj = frame_meta.obj_meta_list
        while l_obj is not None:
            obj_meta = pyds.NvDsObjectMeta.cast(l_obj.data)

            class_id = obj_meta.class_id
            confidence = obj_meta.confidence
            rect = obj_meta.rect_params
            x, y, w, h = rect.left, rect.top, rect.width, rect.height
            tracker_id = obj_meta.object_id

            # Custom logic here

            l_obj = l_obj.next
        l_frame = l_frame.next

    return Gst.PadProbeReturn.OK

# Attach probe
osdsinkpad = nvosd.get_static_pad("sink")
osdsinkpad.add_probe(Gst.PadProbeType.BUFFER, osd_sink_pad_buffer_probe, 0)
```

## Output to Kafka

```ini
[message-converter]
enable=1
msg-conv-config=dstest4_msgconv_config.txt
payload-type=0            # 0=DeepStream schema, 1=Minimal, 256=Custom

[message-broker]
enable=1
msg-broker-proto-lib=/opt/nvidia/deepstream/deepstream/lib/libnvds_kafka_proto.so
msg-broker-conn-str=kafka-broker:9092;topic-name
topic=deepstream-events
```

## DeepStream 8 Differences

- New `nvinferserver` element (Triton-based inference)
- Improved Python bindings with context managers
- Native ONNX Runtime support
- Enhanced multi-stream management
- REST API for dynamic stream add/remove

## Best Practices

1. **Use TensorRT engines** — pre-convert models for 10x faster startup
2. **Batch multiple streams** — streammux batches frames for GPU efficiency
3. **Skip frames for non-critical detection** — `interval=2` skips 2 frames between inferences
4. **Use NvDCF tracker** — best accuracy/performance balance
5. **FP16 inference** — `network-mode=2` for 2x speedup with minimal accuracy loss
6. **Output to Kafka** — use message broker for downstream analytics
7. **Monitor performance** — enable `perf-measurement` to track FPS per stream
