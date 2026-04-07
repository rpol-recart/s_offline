# Virtual Environment Rules

## Mandatory venv Check Before Installing Dependencies

**Every agent that runs `pip install`, `pip`, or any package installation command MUST first ensure a virtual environment exists and is active in the current project.**

### Procedure

1. **Check** if `.venv/` (or `venv/`) directory exists in the project root
2. **If exists** — activate it before running pip:
   - Linux/macOS: `source .venv/bin/activate`
   - Windows: `.venv\Scripts\activate`
3. **If does NOT exist** — create and activate:
   ```bash
   python3 -m venv .venv          # Linux/macOS
   # or
   python -m venv .venv           # Windows
   ```
   Then activate (see above), then proceed with installation.
4. **Verify Python version** — after activation, run `python --version` and confirm it is **>= 3.11**. If the system Python is older, look for `python3.11`, `python3.12`, or `python3.13` and use it explicitly:
   ```bash
   python3.12 -m venv .venv
   ```

### Rules

- **NEVER run `pip install` outside a virtual environment** — this pollutes the system Python
- **NEVER use `sudo pip`** — always use venv
- **Always use the project-local `.venv/`** — do not create venvs in other locations
- **Pin versions** — prefer `pip install package==x.y.z` over bare `pip install package`
- **If `requirements.txt` exists** — install from it: `pip install -r requirements.txt`
- **After installing new packages** — update `requirements.txt`:
  ```bash
  pip freeze > requirements.txt
  ```
  Or add the specific package manually if the project uses a curated requirements file.

### Quick Reference (copy-paste)

```bash
# Full sequence: check, create if needed, activate, install
# Windows
if not exist .venv python -m venv .venv
.venv\Scripts\activate && python --version && pip install <package>

# Linux/macOS
[ -d .venv ] || python3 -m venv .venv
source .venv/bin/activate && python --version && pip install <package>
```

---

## Python Version Management

### Using pyenv

For projects requiring specific Python versions:

```bash
# Install pyenv (one-time setup)
curl https://pyenv.run | bash

# Add to shell profile (~/.bashrc or ~/.zshrc):
export PYENV_ROOT="$HOME/.pyenv"
export PATH="$PYENV_ROOT/bin:$PATH"
eval "$(pyenv init --path)"
eval "$(pyenv init -)"

# Install a specific Python version
pyenv install 3.12.4

# Set global default
pyenv global 3.12.4

# OR set local version for this project (creates .python-version file)
pyenv local 3.11.9
```

When using pyenv with venv:
```bash
# Create venv with pyenv-managed Python
$(which python) -m venv .venv  # Uses current pyenv Python
```

### Using asdf

Alternative plugin-based version manager:

```bash
# Install asdf
git clone https://github.com/asdf-vm/asdf.git ~/.asdf --branch v0.14.0

# Add Python plugin
asdf plugin add python https://github.com/danhper/asdf-python.git

# Install Python version
asdf install python 3.12.4

# Set version
asdf local python 3.12.4    # Project-specific (.tool-versions)
asdf global python 3.12.4   # Default globally
```

---

## Project Isolation Best Practices

### Per-Project Isolation

| Aspect | Recommendation |
|--------|----------------|
| **venv location** | Always `.venv/` in project root |
| **Python version** | Pin via `-m venv` with explicit `python3.x` |
| **requirements** | Separate `requirements.txt` per project |
| **.gitignore** | Include `.venv/`, `*.pyc`, `__pycache__/` |

### Multi-Project Workspaces

When working across multiple projects:

```bash
# Explicit path activation prevents cross-contamination
cd /path/to/project_a && source .venv/bin/activate && pip install reqs
cd /path/to/project_b && source .venv/bin/activate && pip install reqs

# Deactivate between switches if unsure
deactivate
```

⚠️ **Warning**: Do NOT share venvs between unrelated projects even if they claim same dependencies. Minor version drift causes subtle bugs.

---

## Dependency Pinning Requirements

### When to Pin Versions

| Scenario | Pinning Level |
|----------|---------------|
| Production deployment | Exact pins: `package==1.2.3` |
| Development/testing | Minimum version: `package>=1.2.0` |
| Internal tools | Loose: `package~=1.2` (compatible release) |
| New project bootstrap | Start exact; relax after stability verified |

### Pin Format Examples

```text
# requirements.txt - production (exact pins)
fastapi==0.112.0
pydantic==2.6.1
uvicorn==0.30.0

# requirements-dev.txt - development (minimums acceptable)
pytest>=8.0.0
black>=24.0.0
mypy>=1.8.0
```

### Updating Dependencies Safely

```bash
# 1. Dry-run upgrade to see changes
pip list --outdated
pip install --dry-run --upgrade -r requirements.txt

# 2. Use pip-tools for lock files
pip-compile --upgrade requirements.in

# 3. Update one package at a time and test
pip install --upgrade fastapi
```

---

## Troubleshooting Common Issues

| Problem | Solution |
|---------|----------|
| `ModuleNotFoundError` | Ensure venv activated (`which python` should show `.venv/bin/python`) |
| `PermissionError: [Errno 13]` | You're trying to use `pip` without venv; activate first |
| Venv won't activate | Check shell compatibility: Unix uses `source`, Windows uses direct path |
| Wrong Python version in venv | Delete `.venv/` and recreate with explicit interpreter: `python3.12 -m venv .venv` |
| `command not found` in venv | Reinstall package: `pip install package_name` |
