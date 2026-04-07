---
name: ds-mental-models
description: Mental models for data science agents - problem classification, 
             model selection, and thinking frameworks for DS tasks including
             soft sensing, time series, and industrial AI applications
---

## DS Mental Models Skill

Use this skill when working on data science tasks to apply structured thinking frameworks.

## Quick Start

### Step 1: Classify the Task
Read `./architecture_prompts/ds_dispatch.yaml` to classify your task type:
- `unmeasurable_target` — target cannot be measured directly (use proxies)
- `physics_engineering` — physical/engineering systems
- `multi_scale` — data at multiple time scales
- `safety_critical` — catastrophic failures possible
- `hidden_state` — need to estimate latent/internal state
- `signal_analysis` — raw sensor signal analysis

### Step 2: Load Relevant Models
Based on classification, load models from:
- `./architecture_prompts/models/foundations/` — universal models (21 files)
- `./architecture_prompts/models/domains/` — domain adaptations (4 files)
- `./architecture_prompts/models/paradigms/` — problem paradigms (8 files)

### Step 3: Apply Thinking Frameworks
For each activated model:
1. Read the `think_like` instruction
2. Apply the `thinking_process` steps
3. Use the `prompt_fragment` in your analysis

## Pre-configured Bundles

For common tasks, use these bundle combinations:

**Soft Sensing (Al₂O₃, battery SOC, etc.):**
- `soft_sensing` bundle → proxy_mediated + state_reconstruction + constraint_driven + physics_first + multiscale_fusion + frequency_domain + safety_first + control_loop

**Anomaly Detection:**
- `anomaly_detection` bundle → proxy_mediated + safety_first + multiscale_fusion + frequency_domain + control_loop

**Standard ML:**
- `foundation_modeling` bundle → bayesian + tradeoff_framing + systems_thinking + hypothesis_driven + data_quality + feature_engineering + model_selection + evaluation + error_analysis + uncertainty_quantification

## Model Reference

### Foundation Models (Always Available)
- `mm_bayesian_reasoning` — Update beliefs with evidence
- `mm_tradeoff_framing` — Design decisions, not search for perfect
- `mm_systems_thinking` — See whole ecosystem
- `mm_hypothesis_driven` — Test specific hypotheses
- `mm_causal_inference` — Correlation ≠ causation
- `mm_time_series` — Temporal dependencies matter
- `mm_data_quality` — Assess before modeling
- `mm_feature_engineering` — Create informative features
- `mm_evaluation` — Multi-criteria assessment
- `mm_error_analysis` — Categorize and diagnose errors
- `mm_uncertainty_quantification` — Report confidence
- `mm_reproducibility` — Track versions and seeds

### Paradigm Shifts (Problem-Type Specific)
- `ps_proxy_mediated` — For targets you CANNOT measure directly
- `ps_state_reconstruction` — For hidden/latent state estimation
- `ps_constraint_driven` — For learning without labels
- `ps_safety_first` — For catastrophic failure prevention
- `ps_multiscale_fusion` — For multi-time-scale data
- `ps_frequency_domain` — For signal decomposition
- `ps_control_loop` — For model in control system

### Domain Adaptations (When Domain Known)
- `da_physics_first` — For physical/engineering systems
- `da_time_critical` — For real-time control
- `da_bio_med` — For medical/biological
- `da_financial` — For finance/risk

## Example Workflow: Al₂O₃ Estimation

```
Task: Estimate Al₂O₃ concentration in electrolyzer from Noise sensor

1. Classify:
   - unmeasurable_target: Al₂O₃ cannot be measured directly
   - physics_engineering: Electrolyzer is a physical system
   - multi_scale: 1Hz sensor data + 4-hour lab measurements

2. Load Models:
   - From soft_sensing bundle: proxy_mediated, state_reconstruction, physics_first, multiscale_fusion, safety_first, control_loop
   - Add: bayesian, uncertainty_quantification

3. Apply Thinking:
   Proxy-Mediated:
   - Target: Al₂O₃ concentration (cannot measure)
   - Proxies: Noise (voltage fluctuations), pseudo-resistance
   - Chain: Al₂O₃ → solubility → bubble dynamics → voltage fluctuations → Noise
   
   Safety-First:
   - Catastrophe: Anode Effect (AE) - voltage spike to 30-50V
   - Precursors: Noise spike, regime=Starving, ForeAE
   - Thresholds: Al₂O₃ < 2.0% → WARNING

4. Deliver:
   "Al₂O₃ ≈ 2.1% ± 0.4% (95% CI: [1.7%, 2.5%])
   Risk of AE: LOW (current estimate > 2.0%)
   Recommendation: Continue monitoring"
```

## File Locations
- Dispatch config: `./architecture_prompts/ds_dispatch.yaml`
- Foundation models: `./architecture_prompts/models/foundations/`
- Domain models: `./architecture_prompts/models/domains/`
- Paradigm models: `./architecture_prompts/models/paradigms/`
