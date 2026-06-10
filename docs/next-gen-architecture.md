# GeoFlow / NotebookFlow — Next-Generation GIS Visual Programming Platform

> 状态:v0.3 已落地「增量执行引擎 + 目录感知 AI 规划 + AST 数据流 notebook 导入」。
> 本文档记录这一轮的诊断与改动,以及后续演进蓝图。

## 一、v0.2 的问题诊断

### AI workflow 质量差的根因

| # | 问题 | 位置 | 后果 |
|---|------|------|------|
| 1 | LLM 看不到节点库,只输出抽象步骤 | `planner.py` | 节点选择靠 8 个硬编码关键词,几乎选不准 |
| 2 | LLM 返回 ```json 围栏时 `json.loads` 失败 | `planner.py` | 静默降级到规则启发式 —— 配了 API 也"像没配一样" |
| 3 | 临时节点是固定模板,不是 AI 生成 | `temp_node_factory.py` | 大多数生成 `df_out = df_in.copy()` 占位 |
| 4 | notebook 导入直接塞原始 cell 代码 | `notebook_standardizer.py` | cell 引用 `df`/`gdf` 等原变量名,与 `df_in/df_out` 约定不符,执行必然 NameError |
| 5 | notebook 边强制线性串联 | `notebook_standardizer.py` | 不反映真实数据流,分支结构全部丢失 |
| 6 | 组合后参数全是默认值(`file_path=None`) | `workflow_composer.py` | 生成的 workflow 不改 JSON 跑不起来 |

### 速度差的根因

| # | 问题 | 位置 |
|---|------|------|
| 1 | 每次 Run 都 `store.clear()` 全图重算,没有任何缓存 | `workflow_engine.py` |
| 2 | 单节点运行也重算全部上游 | `run_single_node` |
| 3 | 节点代码每次执行都重新 `compile()` | `executors.py` |
| 4 | 下游可能原地修改上游 DataFrame,导致不能安全共享/缓存 | 引擎传引用 |

## 二、v0.3 已落地的改进

### 1. 增量执行引擎(KNIME 式,速度核心)

- **内容指纹**:`node_fingerprint = sha256(type + code + params + 输入文件 mtime/size + 上游指纹链)`,
  见 `workflow_engine.py::node_fingerprint`。
- **结果缓存**:`data_store.py::ResultCache`(LRU,默认 32 条、单 df ≤256MB)。
  指纹命中 → 直接复用上次结果,不执行代码。改了下游节点的参数,只重算从该节点开始的子链。
- **编译缓存**:`executors.py` 按代码哈希缓存 `compile()` 产物。
- **变异安全**:全局开启 pandas Copy-on-Write,并向节点代码传 `df.copy(deep=False)`(CoW 下零拷贝),
  下游原地改 `df_in` 不会污染缓存(有测试覆盖)。
- **可观测**:每个节点返回 `cached` / `elapsed_ms`,日志输出
  `Workflow finished in X ms (N executed, M from cache)`。
- API:`POST /api/workflow/run` 与 `/api/node/run` 接受 `use_cache: bool`(默认 true);
  `POST /api/cache/clear` 强制全量重算。

典型收益:迭代调参场景(改最后一个可视化节点的参数再 Run),上游 IO/清洗/空间运算全部缓存命中,
耗时从"全图重算"降为"单节点执行"。

### 2. 目录感知的 AI 规划(质量核心)

- `planner.py` 把**完整节点目录**(id、IO 契约、参数及枚举选项)注入 prompt,
  并要求每个步骤返回:`node_id`(库内节点)+ `params`(具体参数值)+ `code`(仅当库内无匹配时,
  按 `df_in/params/df_out/html_out` 约定生成代码)。
- `extract_json_object` 容忍 markdown 围栏、前后闲聊文本 —— 修复了"配了 API 仍然走降级"的静默失败。
- `workflow_composer.py`:优先采用 planner 直接选择的 `node_id` 与参数(按 spec 参数白名单合并);
  其次走改进版检索器;最后才落临时节点 —— 临时节点优先使用 planner 生成的代码
  (经 `scan_generated_code` 安全扫描:禁 subprocess/os.system/eval/exec/socket 等),模板只是兜底。
- `node_retriever.py`:概念映射(read/geo/map/hist/group/filter/join/buffer + 同义词、复合词子串匹配、
  单复数归一)+ IO 契约加权。无 LLM 时纯启发式也能把常见步骤全部映射到正确节点。
- 环境变量:`AI_TIMEOUT_SECONDS`(默认 60)。

### 3. AST 数据流 notebook 导入(导入即可运行)

`notebook_standardizer.py` v0.3:

- 用 `ast` 解析每个 cell,提取 **free names**(使用了但本 cell 未先赋值 → 外部依赖)与
  **assigned names**(本 cell 产出)。
- **边 = 真实数据流**:当前 cell 的 free name 由哪个 cell 最近产出,就连谁 —— 分支结构得以保留,
  不再是强制线性链。
- **变量桥接**:临时节点自动包裹
  `df = df_in  # bridged` … `df_out = df2  # bridged`,notebook 原变量名与节点约定无缝衔接,
  导入的 workflow 可以直接 Run(有端到端测试)。
- 纯 import cell 合并进下一个 cell;`%magic` / `!shell` 行剥离为注释。
- builtin 映射只在**能恢复关键参数**时才发生(如 `read_csv('path')` 提取出 file_path),
  否则保留原代码为可运行的临时节点 —— 避免生成参数为空的"假标准节点"。

### 4. 测试

`backend/tests/test_smoke.py`(纯 python 可跑,无需 pytest/fastapi):
缓存命中与失效、变异安全、JSON 提取、检索器六类步骤全对、临时节点代码安全扫描、
notebook 分支 DAG 端到端执行、read_csv 参数提取端到端执行。

## 三、下一代演进蓝图(建议路线)

### 阶段 A:执行层(速度/规模)

1. **类型化端口系统**:把 `inputs/outputs` 从 dict 升级为 `PortSpec(name, dtype: Table|GeoTable|Raster|HTML|Model)`,
   多输入端口(join/overlay 需要两个 df_in)→ 引擎按端口取数;校验器做真正的类型检查。
2. **磁盘溢出缓存**:ResultCache 超内存上限时落 Parquet/GeoParquet(`tmp/cache/<fingerprint>.parquet`),
   重启进程缓存仍有效 —— 这是"项目级持久化"的基础。
3. **并行分支执行**:拓扑排序后按"就绪集"并行(`ProcessPoolExecutor` + Arrow IPC 传输),
   GIS 重算子(overlay、buffer)受益最大。先做进程池版,远期可换 ray/dask。
4. **流式进度**:`/api/workflow/run` 改 SSE/WebSocket,逐节点推送状态,前端节点实时变绿
   (现在是整次请求结束才返回)。

### 阶段 B:AI 层(从"生成草稿"到"自我修复")

5. **执行反馈闭环**:compose 后自动 dry-run,把报错节点 + traceback 回传 LLM 修复(最多 N 轮)——
   这是生成质量提升最大的单项改动。
6. **嵌入检索**:节点库大了以后,关键词概念映射换成向量检索(spec 描述 embedding + top-k 注入 prompt)。
7. **数据感知规划**:plan 请求携带已上传文件的 schema(列名/类型/CRS/几何类型),
   LLM 直接填出正确列名参数。前端在上传后把 schema 写进 `data_context` 即可,后端已支持。
8. **GIS 文献摄取做实**:当前 `gis_ingest.py` 生成占位代码。升级为:文章/方法描述 → LLM 生成完整
   node spec(参数 + 实现代码)→ 安全扫描 → 沙箱试跑(合成小数据)→ 通过才入库,
   状态机 pending → verified。
9. **ipynb 摄取 LLM 增强**:AST 给结构,LLM 给语义 —— 对每个 cell 生成标题/参数化建议
   ("把硬编码的 0.05 提成 params['threshold']"),把一次性代码升级为可复用节点。

### 阶段 C:平台层(生态)

10. **节点 SDK**:装饰器定义节点,自动生成 spec:
    ```python
    @node(category="GIS", label="Buffer")
    def buffer(df_in: GeoTable, distance: float = 100.0) -> GeoTable:
        return df_in.assign(geometry=df_in.geometry.buffer(distance))
    ```
    扫描 Python 包入口(entry_points)即插件机制 —— 社区扩展节点库的前提。
11. **项目持久化**:workflow + 节点库 + 数据引用存成 `.geoflow` 项目目录(git 友好的 JSON),
    替代现在的纯前端内存态。
12. **GIS 一级公民节点集**:CRS 变换、空间 join、buffer/overlay、栅格(rasterio)、
    地理编码、H3/网格聚合 —— 用 SDK 写,同时成为 AI 规划的高质量素材。

### 优先级建议

速度感最大:A4(流式进度)+ A2(磁盘缓存);
AI 质量最大:B5(自修复闭环)+ B7(数据感知规划);
生态决定上限:C10(节点 SDK)。
