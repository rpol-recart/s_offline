# Serena MCP Server — Установка и подключение к opencode

## Требования

- Python 3.11+
- pip или uv (с доступом к PyPI)

---

## Часть 1: Установка Serena

```bash
pip install serena_agent-1.0.0-py3-none-any.whl
```

pip автоматически скачает все зависимости (~70 пакетов) с PyPI.

Проверка:

```bash
serena --help
```

---

## Часть 2: Глобальная конфигурация (один раз на машину)

```bash
mkdir -p ~/.serena

cat > ~/.serena/serena_config.yml << 'EOF'
language_backend: LSP
line_ending: native
gui_log_window: false
web_dashboard: false
web_dashboard_open_on_launch: false
log_level: 20
tool_timeout: 240
default_max_tool_answer_chars: 150000
default_modes:
- interactive
- editing
projects: []
EOF
```

**Для Python:** LSP (pyright) уже встроен — работает из коробки.

**Для TypeScript:** дополнительно нужен:

```bash
npm install -g typescript typescript-language-server
```

---

## Часть 3: Подключение к opencode

### Шаг 1: Добавить mcpServers в opencode.json

В файл `.opencode/opencode.json` добавить блок `mcpServers`:

```json
{
  "mcp": {
    "serena": {
      "type": "local",
      "command": ["serena", "start-mcp-server"]
    }
  }
}
```

Если `serena` не в PATH — указать полный путь:

```json
{
  "mcp": {
    "serena": {
      "type": "local",
      "command": ["/path/to/venv/bin/serena", "start-mcp-server"]
    }
  }
}
```

**Пример** (serena установлена в venv проекта):

```json
{
  "mcp": {
    "serena": {
      "type": "local",
      "command": ["/root/swarms_fw/.venv/bin/serena", "start-mcp-server"]
    }
  }
}
```

### Шаг 2: Создать .serena/project.yml в проекте

В **корне каждого проекта** создать файл `.serena/project.yml`:

```bash
cd /path/to/project
mkdir -p .serena

cat > .serena/project.yml << 'EOF'
name: my-project
languages:
  - python
encoding: utf-8
read_only: false
ignored_paths:
  - node_modules/**
  - .venv/**
  - __pycache__/**
  - .git/**
  - dist/**
  - build/**
  - "*.pyc"
EOF
```

**Зачем нужен project.yml?** Serena использует LSP (Language Server Protocol).
Для каждого языка запускается свой LSP-сервер:
- Python → pyright (встроен)
- TypeScript → typescript-language-server (нужен npm install)
- Go → gopls
- Rust → rust-analyzer
- и т.д.

Без `project.yml` Serena не знает какой LSP запускать.

### Шаг 3: Проверка

```bash
# Проверить что Serena видит проект
serena project list

# Проверить инструменты
serena tools list
```

---

## Часть 4: Использование агентами

После подключения opencode-агенты получают инструменты:

| Инструмент | Описание | Экономия vs read |
|-----------|----------|-----------------|
| `get_symbols_overview` | Все классы/функции файла | 5-10x |
| `find_symbol` | Поиск символа по имени/паттерну | 3-5x |
| `find_referencing_symbols` | Кто вызывает символ | 10-20x |
| `search_for_pattern` | Regex-поиск по коду | 2-3x |
| `list_dir` | Структура директории | 1x |
| `read_file` | Чтение файла (с диапазоном строк) | 1x |
| `replace_symbol_body` | Замена тела функции | точечно |
| `insert_before_symbol` | Вставка перед символом | точечно |
| `insert_after_symbol` | Вставка после символа | точечно |
| `rename_symbol` | Переименование везде | безопасно |

### Правило навигации для 32K контекста

```
1. get_symbols_overview  — обзор модуля         (~300 токенов)
2. find_symbol           — конкретный символ     (~200 токенов)
3. find_referencing_symbols — кто вызывает       (~400 токенов)
4. read_file (строки)    — тело если нужно       (~400 токенов)
   ────────────────────────────────────────────
   НИКОГДА: read_file без start_line/end_line для файлов >100 строк
```

---

## Часть 5: Примеры project.yml для разных проектов

### Python-проект

```yaml
name: my-api
languages:
  - python
encoding: utf-8
ignored_paths:
  - .venv/**
  - __pycache__/**
  - .git/**
```

### TypeScript + Python

```yaml
name: fullstack-app
languages:
  - python
  - typescript
encoding: utf-8
ignored_paths:
  - node_modules/**
  - .venv/**
  - __pycache__/**
  - .git/**
  - dist/**
  - build/**
```

### Go-проект

```yaml
name: microservice
languages:
  - go
encoding: utf-8
ignored_paths:
  - vendor/**
  - .git/**
```

### Java + Kotlin

```yaml
name: android-app
languages:
  - java
  - kotlin
encoding: utf-8
ignored_paths:
  - build/**
  - .gradle/**
  - .git/**
```

---

## Содержимое пакета

```
serena/
  INSTALL.md                              — эта инструкция
  serena_agent-1.0.0-py3-none-any.whl     — пакет Serena (746 KB)
```

## Поддерживаемые языки

python, typescript, javascript, go, rust, java, kotlin, csharp, php, ruby,
swift, scala, clojure, elixir, erlang, haskell, ocaml, fsharp, dart, lua,
zig, nix, perl, bash, r, julia, fortran, pascal, cpp, matlab, yaml, toml,
markdown, terraform, solidity, vue, и другие.
