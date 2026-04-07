---
name: gradio-ui
description: "Gradio 6.5.1 interface patterns — layouts, components, events, theming, deployment"
---

# Gradio UI Skill (Gradio 6.5.1)

## When to Use

When building interactive web UIs for ML models, data tools, dashboards, or any Python application that needs a browser interface.

## Core Patterns

### App Structure

```python
import gradio as gr

# Blocks API — full control
with gr.Blocks(theme=gr.themes.Soft(), title="App Name") as demo:
    gr.Markdown("# App Title")

    with gr.Row():
        with gr.Column(scale=2):
            input_component = gr.Textbox(label="Input")
        with gr.Column(scale=1):
            output_component = gr.Textbox(label="Output")

    btn = gr.Button("Run", variant="primary")
    btn.click(fn=process, inputs=[input_component], outputs=[output_component])

demo.launch(server_name="0.0.0.0", server_port=7860)
```

### Key Components (Gradio 6.5.1)

| Component | Use For |
|-----------|---------|
| `gr.Textbox` | Text input/output |
| `gr.Image` | Image upload/display (type="pil" or "numpy") |
| `gr.Video` | Video upload/playback |
| `gr.Audio` | Audio input/output |
| `gr.Dataframe` | Tabular data display/edit |
| `gr.Plot` | Matplotlib/Plotly charts |
| `gr.File` | File upload/download |
| `gr.Chatbot` | Chat interface (type="messages" for OpenAI format) |
| `gr.Gallery` | Image grid display |
| `gr.Model3D` | 3D model viewer (GLB, OBJ) |
| `gr.JSON` | JSON display |
| `gr.Code` | Code editor with syntax highlighting |
| `gr.Dropdown` | Select from options |
| `gr.Slider` | Numeric range input |
| `gr.Checkbox` | Boolean toggle |
| `gr.Radio` | Single choice from options |
| `gr.Number` | Numeric input |
| `gr.ColorPicker` | Color selection |

### Layout Components

```python
with gr.Blocks() as demo:
    with gr.Tab("Tab 1"):           # Tabbed navigation
        with gr.Row():               # Horizontal layout
            with gr.Column(scale=2):  # Weighted column
                ...
            with gr.Column(scale=1):
                ...
    with gr.Tab("Tab 2"):
        with gr.Accordion("Advanced Settings", open=False):  # Collapsible
            ...
    with gr.Row():
        with gr.Group():  # Visually grouped components
            ...
```

### Event Handling

```python
# Button click
btn.click(fn=predict, inputs=[img], outputs=[label, confidence])

# Change event (auto-trigger)
slider.change(fn=update_preview, inputs=[slider], outputs=[preview])

# Submit on Enter
textbox.submit(fn=search, inputs=[textbox], outputs=[results])

# Streaming output
def generate_stream(prompt):
    for token in model.generate(prompt):
        yield accumulated_text

btn.click(fn=generate_stream, inputs=[prompt], outputs=[output])

# Progress tracking
def long_task(input, progress=gr.Progress()):
    for i in progress.tqdm(range(100), desc="Processing"):
        ...
    return result
```

### Chat Interface

```python
# Simple chatbot
chatbot = gr.Chatbot(type="messages")
msg = gr.Textbox(placeholder="Type a message...")

def respond(message, history):
    # history is list of {"role": "user"/"assistant", "content": "..."}
    response = model.generate(message, history)
    history.append({"role": "user", "content": message})
    history.append({"role": "assistant", "content": response})
    return "", history

msg.submit(respond, [msg, chatbot], [msg, chatbot])

# Or use ChatInterface shortcut
demo = gr.ChatInterface(fn=respond, type="messages")
```

### Theming

```python
# Built-in themes
gr.Blocks(theme=gr.themes.Default())
gr.Blocks(theme=gr.themes.Soft())
gr.Blocks(theme=gr.themes.Glass())
gr.Blocks(theme=gr.themes.Monochrome())

# Custom theme
theme = gr.themes.Soft(
    primary_hue="blue",
    secondary_hue="gray",
    font=[gr.themes.GoogleFont("Inter"), "sans-serif"],
)
```

### File Handling

```python
def process_upload(file):
    # file is a NamedTemporaryFile path (str)
    df = pd.read_csv(file)
    return df

file_input = gr.File(label="Upload CSV", file_types=[".csv", ".xlsx"])
output_df = gr.Dataframe()
file_input.change(fn=process_upload, inputs=[file_input], outputs=[output_df])
```

### State Management

```python
# Session state (per-user)
state = gr.State(value={"count": 0})

def increment(state_val):
    state_val["count"] += 1
    return state_val, f"Count: {state_val['count']}"

btn.click(fn=increment, inputs=[state], outputs=[state, label])
```

## Deployment Patterns

```python
# Local
demo.launch()

# Public share link (72h)
demo.launch(share=True)

# Production server
demo.launch(
    server_name="0.0.0.0",
    server_port=7860,
    auth=("admin", "password"),      # Basic auth
    ssl_verify=False,
    max_threads=10,
)

# Mount in FastAPI
from fastapi import FastAPI
app = FastAPI()

@app.get("/api/health")
def health():
    return {"status": "ok"}

demo = gr.Blocks()
# ... build demo ...
app = gr.mount_gradio_app(app, demo, path="/ui")
```

## Best Practices

1. **Use `gr.Blocks`** over `gr.Interface` for anything beyond a single function
2. **Debounce expensive operations** — use `every=` parameter or button triggers instead of `.change()`
3. **Show progress** — use `gr.Progress()` for long-running tasks
4. **Handle errors** — wrap processing in try/except, return user-friendly messages via `gr.Warning()` / `gr.Error()`
5. **Responsive layout** — use `gr.Row()` and `gr.Column(min_width=)` for mobile
6. **Lazy loading** — use `visible=False` and toggle visibility for complex UIs
7. **Queue for heavy models** — `demo.launch(queue=True)` for GPU inference
