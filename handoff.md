# Handoff — GeoFlow / NotebookFlow v0.3 改进会话

> 日期:2026-06-10
> 任务:基于现有架构修正并提升 AI workflow、自动建节点、以及执行速度。
> 状态:**全部完成,7 项冒烟测试通过,已提交到 main(commit `3b81ab5`)**。
> 测试入口:Windows 双击 `start.bat`(启动)/ `run_tests.bat`(测试);macOS 用 `./start.sh`。

## 一、问题诊断(本次会话的结论)

### AI workflow 做得不好的根因

1. **LLM 看不到节点库**(`planner.py`):旧 planner 只让模型输出抽象步骤
   (title/intent/io_type),再用 8 个硬编码关键词匹配节点 —— 选不准节点、填不了参数。
2. **静默降级**(`planner.py`):模型返回 ```json 围栏包裹的回复时 `json.loads`
   直接失败,悄悄退回规则启发式 —— **配了 API key 也基本一直在用最笨的方案**,
   这是"AI 看起来不工作"的直接原因。
3. **临时节点不是 AI 生成**(`temp_node_factory.py`):只有 4 个固定模板,
   多数产出 `df_out = df_in.copy()` 占位代码。
4. **Notebook 导入的节点跑不起来**(`notebook_standardizer.py`):原始 cell 代码引用
   `df`/`gdf` 等原变量名,与节点的 `df_in/df_out` 约定不符,执行必然 NameError;
   且边强制线性串联,丢失真实数据流/分支结构。
5. **组合出的 workflow 参数全是默认值**(`workflow_composer.py`):`file_path=None`,
   不手改 JSON 跑不起来。

### 速度慢的根因

- 引擎每次 Run 都 `store.clear()` 全图重算;单节点运行也重算全部上游;无任何缓存
  (`workflow_engine.py`)。
- 节点代码每次执行重新 `compile()`(`executors.py`)。

## 二、已完成的修改

全部在 `notebookflow/backend/`,前端无需改动(API 字段为增量添加,向后兼容)。

### 1. 增量执行引擎(速度核心)

- `workflow_engine.py`:新增 `node_fingerprint()` —
  sha256(节点类型 + 代码 + 参数 + 输入文件 mtime/size + 上游指纹链)。
  指纹命中缓存 → 直接复用结果不执行;改某节点只重算它及其下游。
- `data_store.py`:新增 `ResultCache`(LRU,默认 32 条,单 DataFrame ≤256MB 才缓存)。
- `executors.py`:`compile()` 结果按代码哈希缓存;全局开启 pandas Copy-on-Write。
- 变异安全:向节点代码传 `df.copy(deep=False)`(CoW 下零成本),
  下游原地修改 `df_in` 不会污染缓存 —— 有专门测试。
- 可观测:每节点输出 `cached` / `elapsed_ms`;日志含
  `Workflow finished in X ms (N executed, M from cache)`。
- API:run 请求支持 `use_cache: bool`(默认 true);新增 `POST /api/cache/clear`。

### 2. 目录感知 AI 规划(质量核心)

- `planner.py` 重写:节点目录(id/IO 契约/参数/枚举)注入 prompt;每步返回
  `node_id` + 具体 `params` + 兜底 `code`;`extract_json_object()` 容忍 markdown
  围栏与闲聊文本;`AI_TIMEOUT_SECONDS` 可配(默认 60)。
- `workflow_composer.py`:优先用 planner 选的 `node_id` 与参数(按 spec 白名单合并);
  其次走检索器;最后才落临时节点。
- `temp_node_factory.py`:优先使用 planner 生成的代码,经 `scan_generated_code()`
  安全扫描(禁 subprocess / os.system / eval / exec / socket / pickle.loads 等),
  模板仅兜底。
- `node_retriever.py` 重写:概念映射(read/geo/map/hist/group/filter/join/buffer
  + 同义词 + 复合词子串 + 单复数归一)+ IO 契约加权。
  **不配 LLM 时**,"load csv → filter → groupby → histogram" 也能 4 步全部映射到正确节点(已验证)。
- `models.py`:`PlanStep` 增加 `node_id/params/code`;新增 `RunWorkflowRequest`;
  `SingleNodeRunRequest` 增加 `use_cache`。

### 3. AST 数据流 notebook 导入(导入即可运行)

- `notebook_standardizer.py` 重写:AST 提取每 cell 的自由变量(外部依赖)与赋值变量(产出);
  **边按真实数据流连接**(保留分支);自动桥接变量名
  (`df = df_in` 前缀、`df_out = df2` 后缀);纯 import cell 合并进下一 cell;
  `%magic`/`!shell` 行剥离为注释;builtin 映射仅在能恢复关键参数时发生
  (如 `read_csv('path')` 提取 file_path),避免产出参数为空的假标准节点。

### 4. 测试与文档

- `backend/tests/test_smoke.py`(新,纯 python 可跑,无需 pytest/fastapi):
  缓存命中/失效、`use_cache=false`、变异安全、JSON 提取、检索器 6 类步骤全对、
  代码安全扫描、notebook 分支 DAG 端到端执行、read_csv 参数提取端到端执行。
  **当前全部通过。**
- `docs/next-gen-architecture.md`(新):完整诊断 + 三阶段演进蓝图。
- `notebookflow/README.md`:v0.3 highlights、缓存 API、测试说明、`AI_TIMEOUT_SECONDS`。

### 5. 一键启动脚本(仓库根目录)

- `start.bat`(Windows,双击即可):首次运行自动建 venv、装后端依赖、`npm install`,
  开两个窗口分别跑后端(8000)和前端(5173),并自动打开浏览器。
  启动时若存在 `ai.env.bat` 会自动加载(写 `set AI_API_BASE_URL=...` 等三行即可启用 AI;
  没有该文件也能跑,AI 走规则降级)。
- `run_tests.bat`(Windows):跑 7 项后端冒烟测试。
- `start.sh`(macOS/Linux):同 start.bat,AI 配置读同目录 `ai.env`(`export` 形式)。
- bat 文件为 CRLF 行尾,`.gitattributes` 已固定 `*.bat text eol=crlf`,
  Windows 上 clone/pull 不会被 git 改坏行尾。

## 三、验证方式

**Windows(推荐)**:双击仓库根目录 `start.bat`,浏览器自动打开 http://localhost:5173;
双击 `run_tests.bat` 跑冒烟测试。前置条件:PATH 里有 Python 3.10+ 和 Node.js。

**手动方式**:

```bash
# 后端逻辑测试(只需 pandas + pydantic)
cd notebookflow/backend && python tests/test_smoke.py

# 实际体验(需安装 requirements.txt)
uvicorn app.main:app --reload --port 8000   # backend
cd notebookflow/frontend && npm run dev      # frontend
```

**缓存效果验证**:搭一个简单 workflow 连续 Run 两次,第二次日志显示
`cached (reused previous result)` 与 `Workflow finished in X ms (0 executed, N from cache)`。

## 四、下一步(按收益排序)

1. **AI 自修复闭环**(收益最大):compose 后自动 dry-run,把报错节点 + traceback
   回传 LLM 修复(最多 N 轮)。
2. **流式进度**:run 端点改 SSE/WebSocket,节点逐个变绿。
3. **磁盘缓存**:ResultCache 落 Parquet/GeoParquet,重启进程缓存仍有效。
4. **节点 SDK**(生态上限):装饰器定义节点自动生成 spec + entry_points 插件机制。
5. **数据感知规划**:上传文件后把 schema(列名/类型/CRS)写入 `data_context`,
   LLM 直接填正确列名 —— 后端已支持,只差前端传入。
6. `gis_ingest.py` 仍是占位代码生成,需按蓝图升级为
   "LLM 生成完整 spec → 安全扫描 → 沙箱试跑 → 入库"。
7. 已知局限:引擎仍是单 `df_in` 端口(join/overlay 双输入需要类型化端口系统,
   见架构文档阶段 A1);多用户并发共享一个全局 store/cache(本地单用户场景可接受)。

## 五、关键文件索引

| 文件 | 内容 |
|------|------|
| `notebookflow/backend/app/workflow_engine.py` | 指纹 + 增量执行 + 计时 |
| `notebookflow/backend/app/data_store.py` | ResultCache (LRU) |
| `notebookflow/backend/app/executors.py` | 编译缓存 + CoW |
| `notebookflow/backend/app/services/planner.py` | 目录感知 LLM 规划 + 健壮 JSON 解析 |
| `notebookflow/backend/app/services/workflow_composer.py` | library-first 组合 |
| `notebookflow/backend/app/services/node_retriever.py` | 概念映射检索 |
| `notebookflow/backend/app/services/temp_node_factory.py` | AI 代码 + 安全扫描 |
| `notebookflow/backend/app/services/notebook_standardizer.py` | AST 数据流导入 |
| `notebookflow/backend/tests/test_smoke.py` | 7 项冒烟测试 |
| `docs/next-gen-architecture.md` | 诊断 + 演进蓝图 |
| `start.bat` / `run_tests.bat` / `start.sh` | 一键启动与测试脚本(根目录) |

## 六、节点库界面空白问题(已解决, commit `beda28d` / `928ccab`)

**现象**:左侧 Node Library 只有 "Nodes" 标题,Tabular / GeoData 下列表为空;`node_specs.py` 里 7 个内置节点(read_csv、column_filter、row_filter、groupby、histogram、geofile_reader、geomap)在代码中始终存在,并非被 Git 更新或 backup 删除。

**根因**:界面不直接读 `node_specs.py`,而是前端 `fetchNodeSpecs()` 请求 `GET /api/nodes`;后端未成功启动或 API 不可达时 `specs` 保持 `[]`,且失败仅 `console.error` 无界面提示,看起来像"节点不见了"。

| 环境 | 具体原因 | 修复 |
|------|----------|------|
| Windows | 原 `start.bat` 调用 PATH 上 Windows Store `python` 占位符,venv 创建失败,8000 无服务 | `start.bat` 改为默认 conda **`geoxai`**,启动前检查 pandas |
| Windows | `geoflow` 环境 `import pandas` 崩溃,后端 import 即挂 | 改用 `geoxai`(可通过 `NOTEBOOKFLOW_CONDA_ENV` 覆盖) |
| Mac / Win | `temp_node_factory.py` f-string 含反斜杠,Python 3.11 **SyntaxError**,后端无法 import | 提取 `intent_line` 变量后再拼 f-string(commit `beda28d`) |
| 通用 | 浏览器打开 `http://localhost:8000`(API)而非 `http://localhost:5173`(UI) | 必须用 5173 访问前端 |
| 自定义节点 | 存浏览器 `localStorage`,GIS/临时节点在内存,换机或重启即失 | 与内置 7 节点无关;需导出 JSON 或后续做持久化 |

**验证**:后端 `http://127.0.0.1:8000/api/nodes` 应返回 7 条 JSON;前端 5173 左侧应显示 Tabular(5)+GeoData(2)。Mac:`./start.sh`(Homebrew `python3`+`npm`,缺 Node 时提示 `brew install node`)。示例 workflow:`notebookflow/examples/geoflow_exmaple.json`(路径已改为 `../examples/...` 相对路径,跨平台可 Load)。
