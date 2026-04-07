---
name: architecture-graph-serena
description: "6-layer architecture graph via Serena MCP — symbolic navigation, 
             5-pass iterative build, optimized for 32K context and 10-20K LOC projects"
---

# Architecture Graph via Serena

## When to Use

When you need to build a **6-layer semantic architecture graph** of a codebase using
Serena MCP tools. Optimized for **32K context window** and projects **10-20K LOC**.

**Key advantage over file-reading approach:**
- Uses **symbolic navigation** (symbols, references, patterns) instead of reading whole files
- **5-10x token savings** — ~300-500 tokens per module vs ~1500-3000
- Builds graph **iteratively** in 4-5 passes with compaction between them

---

## Serena MCP Tools — Справочник

Все вызовы через opencode MCP: `serena__<tool_name>`.

| Tool | Что делает | Вход | Токенов |
|------|-----------|------|---------|
| `get_symbols_overview` | Все классы/функции файла | `relative_path`, `depth` | 200-500 |
| `find_symbol` | Поиск символа по имени | `name_path_pattern`, `include_body`, `include_info` | 200-400 |
| `find_referencing_symbols` | Кто использует символ | `name_path`, `relative_path` | 200-1000 |
| `search_for_pattern` | Regex по коду | `substring_pattern`, `paths_include_glob` | 100-2000 |
| `list_dir` | Структура директории | `relative_path`, `recursive` | 50-500 |
| `read_file` | Чтение файла/диапазона | `relative_path`, `start_line`, `end_line` | 100-5000 |

### Правило: Символы → Ссылки → Тело (только если нужно)

```
1. get_symbols_overview  — обзор модуля (дёшево)
2. find_referencing_symbols — кто вызывает (средне)
3. find_symbol include_body=true — тело функции (дорого, только при необходимости)
4. read_file — последний resort (самое дорогое)
```

---

## Модель графа: 6 слоёв

| Layer | Name | Semantic Types | Edge Types |
|-------|------|---------------|------------|
| **L1** | Structural | system, service, rest_endpoint, resource, config, utility, data_access_service, domain_service, entry_point | contains, depends_on, initializes, delegates_to |
| **L2** | Behavioral | workflow | orchestrates, uses, reads, reads_writes, feeds |
| **L3** | Knowledge | model, schema, dto | uses, produces, validates_with |
| **L4** | Quality | anti_pattern, security_issue, reliability_issue, bug | produces, prevents |
| **L5** | Operational | database, orchestration, function | connects_to, orchestrates, feeds |
| **L6** | Deployment | deployment, deployment_config | configures, builds |

---

## Workflow: 5 проходов

### Бюджет контекста (32K)

```
System prompt:        ~1K
PLAN.md:              ~0.5K
Текущий граф (секция): ~2-3K
Serena ответы:         ~3-5K
Рассуждения агента:    ~3-5K
─────────────────────────
Итого за проход:       ~12-15K
Свободно:              ~15-18K
```

**КРИТИЧНО:** между проходами — compaction. Граф живёт в файле, не в контексте.

---

### Проход 1: Discovery — Структура проекта

**Цель:** Карта файлов + обзор символов всех модулей.

**Шаг 1.1: Структура проекта**

```
serena__list_dir(relative_path=".", recursive=true, skip_ignored_files=true)
```

Результат: полное дерево файлов (~200-500 токенов).

**Шаг 1.2: Обзор символов по директориям**

Для каждой значимой директории (src/, app/, lib/, etc.):

```
serena__get_symbols_overview(relative_path="src/api/users.py", depth=1)
serena__get_symbols_overview(relative_path="src/services/user_service.py", depth=1)
... (5-7 файлов за проход)
```

**Шаг 1.3: Классификация**

Для каждого обнаруженного символа определить:

| Файл | Символ | Kind | Layer | Semantic Type |
|------|--------|------|-------|--------------|
| src/api/users.py | UsersBlueprint | Class | L1 | rest_endpoint |
| src/services/user_service.py | UserService | Class | L1 | domain_service |

**Шаг 1.4: Записать в файл**

```json
// project/ARCHITECTURE_GRAPH.json — создать начальную структуру
{
  "meta": {
    "name": "Project Architecture",
    "version": "0.1",
    "created": "2026-04-06",
    "method": "serena-symbolic",
    "passes_completed": 1
  },
  "nodes": [
    {
      "id": "system_main",
      "label": "System",
      "layer": "L1_structural",
      "semantic_type": "system"
    }
    // ... nodes discovered in this pass
  ],
  "edges": [],
  "discovery_queue": ["src/services/", "src/models/"]
}
```

**→ Compaction. Обновить PLAN.md: "Pass 1 done, N nodes found, next: services/"**

---

### Проход 2: Связи — Кто кого вызывает

**Цель:** Построить edges через `find_referencing_symbols`.

**Шаг 2.1: Продолжить обзор оставшихся модулей**

```
serena__get_symbols_overview(relative_path="src/services/order_service.py", depth=1)
serena__get_symbols_overview(relative_path="src/models/user.py", depth=1)
... (ещё 5-7 файлов)
```

**Шаг 2.2: Для ключевых символов — найти вызывающих**

Приоритет: сервисы, точки входа, модели данных.

```
serena__find_referencing_symbols(
  name_path="UserService",
  relative_path="src/services/user_service.py"
)
```

Результат покажет: кто импортирует/вызывает UserService → это edges.

**Шаг 2.3: Маппинг в edges**

Каждая ссылка = edge в графе:

```json
// Serena показала: UsersBlueprint (src/api/users.py) вызывает UserService
{
  "from": "rest_users",
  "to": "service_user",
  "type": "delegates_to",
  "layer": "L1_structural"
}
```

**Правила маппинга Serena → Edge Type:**

| Serena паттерн | Edge Type |
|---------------|-----------|
| REST handler вызывает Service | `delegates_to` |
| Service вызывает другой Service | `uses` |
| Service вызывает Repository/DAO | `reads` или `reads_writes` |
| Любой импортирует Model/DTO | `uses` |
| main.py создаёт Resource | `initializes` |
| System содержит компонент | `contains` |
| Config используется сервисом | `depends_on` |

**Шаг 2.4: Дописать edges в ARCHITECTURE_GRAPH.json**

**→ Compaction. PLAN.md: "Pass 2 done, M edges found, next: models + DB layer"**

---

### Проход 3: Модели данных + Инфраструктура (L3, L5, L6)

**Цель:** Domain models, schemas, DB, Docker.

**Шаг 3.1: Модели данных (L3)**

```
serena__find_symbol(
  name_path_pattern="Schema",
  substring_matching=true,
  include_kinds=[5]  // 5=Class
)
```

Найдёт все классы содержащие "Schema" в имени.

```
serena__find_symbol(
  name_path_pattern="Model",
  substring_matching=true,
  include_kinds=[5]
)
```

**Шаг 3.2: Инфраструктура (L5)**

```
serena__search_for_pattern(
  substring_pattern="(create_engine|connect|Pool|Client|Session)",
  paths_include_glob="*.py",
  restrict_search_to_code_files=true
)
```

**Шаг 3.3: Deployment (L6)**

```
serena__search_for_pattern(
  substring_pattern="(FROM|EXPOSE|CMD|ENTRYPOINT)",
  paths_include_glob="Dockerfile*"
)
serena__read_file(relative_path="docker-compose.yml")
```

**Шаг 3.4: Дописать nodes + edges для L3, L5, L6**

**→ Compaction. PLAN.md: "Pass 3 done, layers L3/L5/L6 populated"**

---

### Проход 4: Quality Issues (L4)

**Цель:** Найти анти-паттерны, проблемы, баги.

**Шаг 4.1: TODO/FIXME/BUG в коде**

```
serena__search_for_pattern(
  substring_pattern="(TODO|FIXME|BUG|HACK|XXX|SECURITY|DEPRECATED)",
  restrict_search_to_code_files=true
)
```

**Шаг 4.2: Анти-паттерны — проверить по шаблонам**

| Анти-паттерн | Serena-запрос |
|-------------|---------------|
| God Class (>20 методов) | `get_symbols_overview(depth=1)` → посчитать методы |
| Circular Dependency | `find_referencing_symbols` в обе стороны |
| Hardcoded Secrets | `search_for_pattern("(password|secret|api_key)\s*=\s*['\"]")` |
| SQL Injection | `search_for_pattern("f['\"].*SELECT.*\\{")` |
| No Error Handling | `find_symbol("except", substring_matching=true)` → проверить покрытие |

**Шаг 4.3: Для каждой находки — создать L4 node + edge `produces`**

```json
{
  "id": "issue_god_class_user_service",
  "label": "God Class: UserService (25 methods)",
  "layer": "L4_quality",
  "semantic_type": "anti_pattern",
  "properties": {
    "severity": "high",
    "file": "src/services/user_service.py",
    "method_count": 25,
    "recommendation": "Split into UserAuthService + UserProfileService"
  }
}
```

**→ Compaction. PLAN.md: "Pass 4 done, K issues found"**

---

### Проход 5: Верификация + Статистика

**Цель:** Проверить полноту графа, собрать метрики.

**Шаг 5.1: Перечитать ARCHITECTURE_GRAPH.json**

**Шаг 5.2: Верификация — каждый node существует в коде**

Для случайных 5-10 узлов:
```
serena__find_symbol(name_path_pattern="UserService", relative_path="src/services/user_service.py")
```

Если символ не найден → удалить node из графа.

**Шаг 5.3: Проверка orphan edges**

```python
# В контексте (агент считает):
node_ids = {n["id"] for n in graph["nodes"]}
orphans = [e for e in graph["edges"]
           if e["from"] not in node_ids or e["to"] not in node_ids]
```

**Шаг 5.4: Проверка критических путей**

Для каждого REST endpoint → проследить путь до БД:
```
REST → Service → Repository → Database
```

Если путь разорван — добавить недостающие edges.

**Шаг 5.5: Статистика**

```json
{
  "statistics": {
    "total_nodes": 42,
    "total_edges": 67,
    "by_layer": {
      "L1_structural": 18,
      "L2_behavioral": 5,
      "L3_knowledge": 8,
      "L4_quality": 6,
      "L5_operational": 3,
      "L6_deployment": 2
    },
    "coverage": {
      "files_total": 57,
      "files_covered": 42,
      "percent": 73.7
    },
    "passes": 5,
    "method": "serena-symbolic"
  }
}
```

**Шаг 5.6: Сгенерировать ARCHITECTURE_GRAPH.md**

Human-readable версия с ASCII-диаграммами критических путей.

**→ Граф готов.**

---

## Правила для агента

### ОБЯЗАТЕЛЬНО

1. **Один проход = одна фаза.** Не пытаться сделать всё за раз.
2. **Записывать результаты в файл** между проходами. Контекст будет compacted.
3. **PLAN.md** — обновлять после каждого прохода (какие модули обработаны, что осталось).
4. **Символы → Ссылки → Тело.** Не читать файлы когда можно запросить символы.
5. **5-7 файлов за проход** — больше не влезет в 32K.

### ЗАПРЕЩЕНО

1. ❌ `read_file` без указания `start_line`/`end_line` для файлов >100 строк
2. ❌ Держать весь граф в контексте (граф живёт на диске)
3. ❌ `get_symbols_overview` с `depth > 1` (экспоненциальный рост токенов)
4. ❌ `find_referencing_symbols` без `relative_path` (обязательный параметр)
5. ❌ Пропускать compaction между проходами

---

## Шаблоны Serena-запросов

### Обзор модуля

```
serena__get_symbols_overview(
  relative_path="src/services/user_service.py",
  depth=1
)
```

### Найти все классы с паттерном в имени

```
serena__find_symbol(
  name_path_pattern="Service",
  substring_matching=true,
  include_kinds=[5],
  relative_path="src/services/"
)
```

### Кто вызывает конкретный класс

```
serena__find_referencing_symbols(
  name_path="UserService",
  relative_path="src/services/user_service.py"
)
```

### Найти все REST endpoints (Flask)

```
serena__search_for_pattern(
  substring_pattern="@(bp|app|router)\\.(get|post|put|delete|route)",
  paths_include_glob="*.py",
  restrict_search_to_code_files=true
)
```

### Найти все REST endpoints (FastAPI)

```
serena__search_for_pattern(
  substring_pattern="@router\\.(get|post|put|delete|patch)",
  paths_include_glob="*.py",
  restrict_search_to_code_files=true
)
```

### Найти импорты модуля

```
serena__search_for_pattern(
  substring_pattern="from\\s+.*user_service\\s+import|import\\s+.*user_service",
  restrict_search_to_code_files=true
)
```

### Найти конфигурацию БД

```
serena__search_for_pattern(
  substring_pattern="(DATABASE_URL|SQLALCHEMY|create_engine|MongoClient|redis\\.Redis)",
  restrict_search_to_code_files=true
)
```

### Проверить существование символа (верификация)

```
serena__find_symbol(
  name_path_pattern="UserService",
  relative_path="src/services/user_service.py",
  include_info=true
)
```

---

## JSON Schema графа

### Node

```json
{
  "id": "string — unique, format: {type}_{name}",
  "label": "string — human-readable name",
  "layer": "L1_structural | L2_behavioral | L3_knowledge | L4_quality | L5_operational | L6_deployment",
  "semantic_type": "string — from layer's type list",
  "purpose": "string — one sentence",
  "properties": {
    "file": "relative path",
    "class": "ClassName (optional)",
    "methods": ["method1", "method2"],
    "issues": ["issue description"]
  }
}
```

### Edge

```json
{
  "from": "source node id",
  "to": "target node id",
  "type": "contains | depends_on | initializes | delegates_to | orchestrates | uses | reads | reads_writes | feeds | produces | prevents | connects_to | configures | builds",
  "layer": "L1_structural | L2_behavioral | L3_knowledge | L4_quality | L5_operational | L6_deployment"
}
```

### Node ID Convention

```
{semantic_type}_{component_name}

rest_users, service_user, model_user_dto, resource_db_pool, config_app
issue_god_class_user_service, db_postgres, deploy_dockerfile
```

---

## Quality Gates

Граф готов если:

- [ ] Все REST endpoints включены (L1)
- [ ] Все сервисы включены (L1)
- [ ] Критические пути REST→DB проверены (L2)
- [ ] Модели данных включены (L3)
- [ ] Минимум 3 quality check выполнены (L4)
- [ ] БД и инфраструктура включены (L5)
- [ ] Покрытие файлов > 70%
- [ ] Нет orphan edges
- [ ] Статистика актуальна
- [ ] ARCHITECTURE_GRAPH.json валидный JSON
- [ ] ARCHITECTURE_GRAPH.md сгенерирован

---

## Токен-бюджет по проходам

| Проход | Serena вызовов | Токенов на Serena | Рабочих токенов | Итого |
|--------|---------------|-------------------|-----------------|-------|
| 1: Discovery | 8-10 | ~3-5K | ~8-10K | ~13K |
| 2: Edges | 10-15 | ~4-6K | ~6-8K | ~12K |
| 3: L3/L5/L6 | 6-10 | ~3-4K | ~6-8K | ~11K |
| 4: Quality | 5-8 | ~2-3K | ~5-7K | ~9K |
| 5: Verify | 8-12 | ~3-4K | ~5-7K | ~10K |
| **Итого** | **37-55** | **~15-22K** | **~30-40K** | — |

Без Serena те же данные стоили бы ~100-150K токенов (чтение файлов).

