# Handoff — GeoFlow / NotebookFlow

> 更新日期:2026-06-13
> 当前版本:**v0.6**(Group/Component 元节点,**尚未提交**;上一个已提交版本 v0.5.8 `0b76723`,main 分支,推送由用户手动执行)
> 测试入口:Windows 双击 `start.bat`(conda env `geoxai`)/ macOS `./start.sh`;
> 后端测试 `run_tests.bat` 或 `cd notebookflow/backend && python tests/test_smoke.py`(9 项,全部通过)。

GeoFlow 是 KNIME 式的本地优先可视化工作流平台(FastAPI 后端 + React/@xyflow 前端),
每个节点是一个 Python cell,约定接收 `df_in`(或多端口 `df_in_2…`/`df_ins`)与 `params`,
产出 `df_out` 和/或 `html_out`。AI 要素贯穿:提示词建流程、AI 建节点、节点内 AI 写代码、notebook 双向转换。

---

## 一、版本演进总览(v0.3 → v0.6)

### v0.6 — Group/Component 元节点(本次会话,**未提交**)
KNIME 式元节点:**Group**(虚线框)/ **Component**(实线框),每个节点 `data.subflow` 保存子流程
(`SubflowData`:nodes/edges/input_map/output_map/direct_input_map/direct_output_map)。
子流程内部用边界条 `group_input_bar`(gib)/ `group_output_bar`(gob),代码为空,执行时跳过。

- **打包/展开**:选中多节点右键 Make Group/Component → `createGroupFromSelection`(端口数对应去重后的出/入边;
  位置以质心为原点存相对坐标);展开 `expandGroup` 用 direct_*_map 还原外部连线。
  **make 时务必保留被打包节点的 `group_type`/`subflow`**(否则嵌套元节点丢子流程,进不去)。
- **画布内端口编辑(无 configure 面板)**:点 GroupNode 端口三角 → +/− 浮窗
  (`handleAddGroupInput/Output`、`handleRemoveGroupInput/Output`)。增删会同步:外层 `inputHandles`/
  `outputHandles`、子流程 bar 的 `portCount`、对应 `input_map`/`output_map` 条目、悬空连线。
  **0 端口的组首次加端口时会自动创建 gib/gob 节点**(之前缺失导致内部数据出不去)。
- **命名**:双击节点下方注释编辑(写入 `annotation`,与普通节点一致,回车换行、点外部提交)。
- **子层运行(关键)**:进入子流程后可单独运行内部节点。后端
  `run_node_in_group(root_nodes, root_edges, group_path, inner_node_id, …)` + `POST /api/node/run-in-group`
  (`GroupNodeRunRequest`,`group_path` 是从根到目标子流程的 group id 链)。**每次从外层图重新计算组输入**
  (沿 group_path 逐层跑上游、读入边数据、注入到该层 gib),**无需先跑整图**;逐层把 bar_data 向下传递
  以支持任意深度嵌套。`run_workflow`/`run_single_node` 新增 `no_clear` 保留 store。
- **多输出收集修复**:`run_workflow` 组执行遍历**全部** `output_map`,各输出按 handle 存
  (`store.put_df(nid, df, g_handle)`,额外的进 `extra_dfs`);并把子流程节点输出 merge 进返回值,
  使进入子流程时内部节点能显示已运行结果(绿色+数据)。
- **导航不重置**:进入/退出组**不再清空 `nodeOutputs`**(节点 id 全局唯一,内外输出共存);
  节点 status 由是否有输出推导(`statusFor`)。**每层视图位置记忆**:进入时存父层 viewport 到栈条目
  `parentViewport`,退出按原样恢复;子流程 viewport 存 `subflowViewportsRef`(按 group id),
  再次进入还原上次位置(`groupBridge` 加 getViewport/setViewport/fitView)。
- **bar 端口外观**:三角贴边(沿用 `.nf-handle-in/out` CSS),竖向按 `(idx+1.5)/(n+2)` 均匀居中分布
  (与普通节点一致);console 里输入条标签 "Input 1/2"、输出条 "Output 1/2"(`portTabPrefix`)。
- **Join Tables 编辑器**:`right_on` 改为从**第二端口**(df_in_2)列名下拉(非文件选择);
  左右输出列可折叠勾选(默认全选)。`JoinTablesEditor`(SelectedNodePanel.tsx)。
- **默认画布缩放**:`fitView` 封顶 `maxZoom: 1.15`(≈最大 2× 缩小 3 档),小工作流不再一打开就最大放大。
- 顺手修复 `notebook_exporter.py` 把 `_upstream_sources`(3 元组)误当 2 元组解包导致导出崩溃。

### v0.3 — 引擎与 AI 质量(`3b81ab5`)

### v0.3 — 引擎与 AI 质量(`3b81ab5`)
- **增量执行引擎**:节点指纹 = sha256(类型+代码+参数+输入文件 mtime/size+全部上游指纹链);
  命中 `ResultCache`(LRU)直接复用;`compile()` 按代码哈希缓存;pandas Copy-on-Write +
  浅拷贝保证缓存不被节点原地修改污染。每节点输出 `cached`/`elapsed_ms`。
- **目录感知 AI 规划**:节点库注入 LLM prompt,步骤返回 `node_id`+具体 `params`+兜底 `code`;
  JSON 解析容忍 markdown 围栏(旧版静默降级的根因);组合优先级 planner → 检索器 → 临时节点。
- **AST 数据流 notebook 导入**:真实数据流边(保留分支),变量名自动桥接,导入即可运行。

### v0.4 — AI Studio 与节点库(`a323276`)
- **33 内置节点**(现 34,含 geo_view):Input×5 / Transform×9 / GIS×8 / Visualization×5(Plotly+folium)/
  Nature View×4(matplotlib+seaborn 出版级 PNG)/ Python Script×2。
- **AI Studio 页**:三个 AI 工具标签(AI Workflow Builder / AI Node Creator / Notebook to Flow)。
- `AIConfig`(base_url/api_key/model)从前端 localStorage 随请求下发,运行时覆盖环境变量;
  预配 Google AI Studio Gemini。
- 节点库按 category 动态分组 + 搜索 + 拖拽到画布(`screenToFlowPosition`)。

### v0.5 — 多输入端口与 Workspace(`843b458`)
- **多输入端口引擎**:按 `targetHandle`(df_in/df_in_2/…)收集入边,节点代码可用
  `df_in_2`、`df_ins`;指纹覆盖每个端口。`join_tables`/`geo_spatial_join` 双端口
  (右端口未连时回退 `right_file_path`)。
- **动态输入节点**:GeoMap/GeoView 可加减端口,图层按端口序自下而上绘制(每层独立配色+图层开关)。
- **GeoView 节点**:静态 PNG 多图层地图(choropleth/dpi/save_path 存盘)。
- 全部节点带 markdown `description`(Info 面板渲染,自写零依赖 Markdown.tsx)。
- Workspace 文件浏览 API(list/mkdir/create-file/delete)。
- 表格预览列头灰字显示字段类型(integer/string/geometry…)。

### v0.5.1–v0.5.3 — 画布交互(KNIME 化)
- 连线:选中加粗变蓝,Delete/Backspace 删除,右键 "Delete connection"。
- 节点:⌘C/⌘V 复制粘贴(带配置、端口数、内部连线),右键菜单 Run/Copy/Reset/Delete,
  画布右键 Paste(落在鼠标处)/Add Text Box;Reset 恢复 idle 并清输出。
- **KNIME 三角端口**:输出 ▶ 贴右侧、输入 ◀ 贴左侧(覆盖 React Flow 默认 translate ±50% 才贴边);
  纯视图节点(仅 html_out)不显示输出端口;端口位于左侧 `(i+0.5)/(n+2)` 处;
  端口数变化时 `updateNodeInternals` 重锚连线(**勿在挂载时调用**,会清空 handle bounds 导致连线消失)。
- 点击输入端口弹 +/− 小浮窗(1 端口时只有 +),点外部关闭。
- 库内单击=预览(Info),双击/回车/拖拽=添加;有选中节点时自动连线
  (仅 df_out→df_in),落位 = 选中节点右侧 2.5×40px,占位则下移避让;粘贴 "Node N" 注释自动续号。
- **节点注释**:名字在图标上方,下方 120px 可编辑多行注释(双击编辑,默认 "Node N",
  存入 `annotation` 字段,**不参与指纹**)。
- **画布文本框**(AnnotationNode):右键添加,可移动/缩放(NodeResizer),
  选中出样式工具栏(填充/边框/字体色+字号),空文字即色带;不进入执行,存于 JSON `annotations`。
- Manual Node 按钮与 NodeCreatorModal 已删除(AI Studio 取代)。

### v0.5.4 — 布局与节点内 AI(`807f4d7`)
- 右侧配置面板:代码三模式(**默认折叠**/内联/全屏 Expand——Monaco 需要具体高度,
  100% 在自适应容器中会塌缩);Apply/Run/Reset/Delete 移到面板底部操作栏;
  双击弹窗(Node Notebook)代码同样默认折叠。
- **节点内 AI Coding**:Python Script (Data/HTML) 节点配置面板带 ✦ AI Coding 区,
  自然语言→`POST /api/code/generate` 生成符合约定的 cell 代码(上游列名作上下文,禁用模式扫描)。
- 画布**框选**:空白处左键拖拽圈选(部分覆盖即选中),整组拖动;平移=中键/滚轮
  (panOnDrag 含右键会吞掉 onPaneContextMenu,故只用 `[1]`)。

### v0.5.5–v0.5.8 — Workspace/导出/外壳(最新)
- **左侧图标栏**(KNIME 式):44px 竖排 5 图标 ▦ⓘ📁✦≣(Logs 字形小,单独 34px),
  默认折叠,点击展开,分割线 ◀ 收回;右栏 ▶ / 下栏 ▼(居中)同样可折叠,
  折叠后边缘细条(◀/▲ Console)展开,画布可最大化。
- **Workspace**:浏览到的文件夹即 root(自动持久化,无需 pin);
  Browse… 弹**系统原生对话框**(macOS osascript `choose folder`,Windows PowerShell
  FolderBrowserDialog 置顶无控制台,Linux zenity→tkinter;失败 501 → 应用内 FolderPickerModal);
  点击 .json 直接作为工作流打开(画布非空先确认)。
- **Save**:对话框(目标文件夹默认 workspace + Browse + 文件名,自动补 .json,可改下载),
  写入 `POST /api/workspace/save-file`。
- **Export → ipynb**(Load 旁):`notebook_exporter.py` 把工作流转成**等价完整 notebook**——
  拓扑序每节点 markdown+code 两个 cell;import 提升去重;`df_in/df_ins` 从上游
  `df_<node>` 变量桥接、结果再发布;html_out 经 IPython.display 内联渲染;
  **params 用 Python 字面量**(json 的 null 会 NameError,已修)。
  冒烟测试真实执行导出的 notebook 并断言与引擎结果相等。
- 下栏只显示运行结果(Console+节点名,无 tab),Logs 移入侧栏 ≣;
  显示区加倍(下栏默认 42%,iframe 400px,表格 300px)。
- AI Studio 不再内嵌 provider 设置(主界面 ✦ AI 标签全局共用);
  Gemini 模型下拉按 3.5/3.1/2.5 分组并带价目提示。
- `backend/workspace/` 已 gitignore(用户数据)。

---

## 二、验证方式

**推荐启动(FlowX shell)**:Windows 双击 `scripts/windows/Launch FlowX.vbs`;
macOS 双击 `scripts/macos/FlowX.app`(首次 `chmod +x launch.sh stop.sh FlowX.app/Contents/MacOS/flowx`).
隐藏后端/前端 + Edge/Chrome `--app` 窗口;**关闭 FlowX 窗口自动停服**。
配置:`scripts/*/config.json.example` → `config.json`;手动停服:`stop.ps1` / `stop.sh`。

**调试启动**:Windows `start.bat` / macOS `./start.sh`(可见终端,Ctrl+C 停止)。
默认 conda env `geoxai`(Windows)或 backend `.venv`(macOS);`ai.env.bat` / `ai.env` 加载 AI 密钥。
浏览器 **http://127.0.0.1:5173**(8000 是 API)。

**后端冒烟测试**(9 项,无需 pytest):
```bash
cd notebookflow/backend && python tests/test_smoke.py
```
覆盖:缓存命中/失效/变异安全、planner JSON 提取、检索器选型、代码安全扫描、
notebook 导入分支 DAG 端到端、read_csv 参数提取、**多输入端口(df_in_2/df_ins/按端口缓存失效)**、
**ipynb 导出等价性(导出后顺序执行=引擎结果)**。

**前端**:`cd notebookflow/frontend && npx tsc --noEmit`(0 错误)+ `npx vite build`。
本仓库 `.claude/launch.json` 配好了 Claude Preview 前端入口,可做浏览器内验证。

---

## 三、关键文件索引

### 后端 `notebookflow/backend/app/`
| 文件 | 内容 |
|------|------|
| `workflow_engine.py` | 拓扑执行 + 多端口收集 + 指纹增量 + dtypes 摘要 + **组/嵌套执行 + `run_node_in_group` + `no_clear`** |
| `data_store.py` / `executors.py` | ResultCache(LRU)/ 编译缓存 + CoW + 多输入命名空间 |
| `node_specs.py` | 34 内置节点(代码+spec+markdown 描述);**join_tables 用 column_right + 列筛选;gib/gob bar 节点 spec** |
| `models.py` | AIConfig、NodeSpec、annotation、**SingleNodeRunRequest.no_clear、GroupNodeRunRequest** 等 |
| `services/planner.py` | 目录感知 LLM 规划(ai_config 覆盖) |
| `services/workflow_composer.py` / `node_retriever.py` / `temp_node_factory.py` | library-first 组合链 |
| `services/notebook_standardizer.py` | ipynb → 工作流(AST 数据流) |
| `services/notebook_exporter.py` | 工作流 → ipynb(等价转换) |
| `services/node_generator.py` | AI 整节点生成 + 节点内 AI Coding(`generate_code`) |
| `services/workspace.py` | 文件浏览/读写/删除 + 原生文件夹对话框(分平台) |
| `services/cwl_exporter.py` | CWL v1.2 导出桩(接口预留) |
| `tests/test_smoke.py` | 9 项冒烟测试 |

### 前端 `notebookflow/frontend/src/`
| 文件 | 内容 |
|------|------|
| `App.tsx` | 全局状态/布局/复制粘贴/右键菜单/保存导出;**组打包/进出(enter/exitGroup)、端口增删、`buildGroupNode`、`buildRootPayload`、`barOutputs`、每层 viewport 记忆** |
| `components/LeftPanel.tsx` | SideRail 图标栏 + Nodes/Info/Workspace/AI/Logs 面板 |
| `components/FlowNode.tsx` | 三角端口、动态端口浮窗、上名下注释布局 |
| `components/GroupNode.tsx` | 元节点渲染(虚/实线框)、端口 +/− 浮窗、可编辑注释、双击进入子流程 |
| `components/GroupBarNode.tsx` | 子流程 IN/OUT 边界条,三角贴边 + `(idx+1.5)/(n+2)` 均匀分布 |
| `groupBridge.ts` | 组件↔App 桥:enterGroup + getViewport/setViewport/fitView |
| `components/AnnotationNode.tsx` | 画布文本框(NodeResizer+样式工具栏) |
| `components/WorkflowCanvas.tsx` | 拖放、框选、右键菜单转发、portActions context、**viewport 注册、fitView maxZoom 封顶** |
| `components/SelectedNodePanel.tsx` | 参数/AI Coding/代码三模式/底部操作栏;**JoinTablesEditor、组节点无 configure 提示** |
| `components/OutputPreview.tsx` | 结果区(表格 dtype 列头/HTML iframe/Expand/**多端口 tab portTabPrefix**) |
| `api/client.ts` | API 封装:**runSingleNode(no_clear)、runNodeInGroup** |
| `components/WorkspacePanel.tsx` / `FolderPickerModal.tsx` / `SaveWorkflowModal.tsx` | Workspace 浏览/选择/保存导出对话框 |
| `components/AIStudioPage.tsx` / `AISettingsPanel.tsx` | AI 工具页 / 共享 provider 设置 |
| `components/CanvasContextMenu.tsx` / `Markdown.tsx` / `portActions.ts` | 右键菜单 / md 渲染 / 节点级动作 context(含 group 端口动作) |

### 根目录
`start.bat` / `start.sh` / `run_tests.bat`(一键脚本)、`docs/next-gen-architecture.md`(蓝图)、
`.claude/launch.json`(预览配置)、`notebookflow/examples/`(示例数据与工作流)。

---

## 四、已知坑(踩过的,别再踩)

1. **React Flow `updateNodeInternals` 不能在节点挂载时调用** —— 会在测量前清空 handle
   bounds,连线永远不渲染;只在端口数变化时调用。
2. **三角端口贴边**:RF 默认 handle 有 `translate(±50%, -50%)`,要覆盖 X 位移才能贴住节点。
3. **`panOnDrag` 含右键(2)会吞掉 `onPaneContextMenu`** —— 只用 `[1]`(中键)。
4. **Monaco `height="100%"`** 在自适应高度容器里塌缩为 0,必须给具体值(calc 也行)。
5. **导出 notebook 的 params 不能用 `json.dumps`**(null→NameError),用 `pprint.pformat`。
6. **Claude Preview 调试**:预览浏览器窗口可能塌缩成 2px 宽 → ResizeObserver 挂起 →
   RF 测不了节点(节点 visibility:hidden、无连线)。重启 preview + `preview_resize` 1440×900,
   截图强制出帧。这不是代码 bug。
7. 浏览器永远拿不到文件夹绝对路径(安全模型),文件夹选择必须靠本地后端弹系统对话框。
8. 旧保存的工作流 JSON 内嵌保存时的节点代码 —— 节点升级后(如 GeoMap 多图层)需从库重新添加。
9. **组执行用独立 store / 子流程数据不持久** —— 单独跑子层节点要么会重置整图、要么 bar 拿不到数据。
   解法:`run_node_in_group` 每次从外层重算组输入并注入 gib(`no_clear` 保留 store),**别**改成跑整图。
10. **进入/退出组别清 `nodeOutputs`** —— 节点 id 全局唯一,清空会让整图"被重置"(状态/输出全没)。
11. **嵌套元节点必须保留 `group_type`+`subflow`** —— `createGroupFromSelection`、`buildPayload`、
    `buildGroupNode`(进入/恢复/展开复用)都要带上,否则内层组渲染成灰节点或进不去。
12. **子层 bar 数据要逐层下传** —— `run_node_in_group` 下钻时若只在最后一层注入 bar_data,
    2 层以上的中间 gib 拿不到数据(NoneType)。必须每层把 bar_data/overrides 传给下一层上游运行。
13. **`fitView` 默认 maxZoom=2** —— 小工作流一打开就最大放大;用 `fitViewOptions.maxZoom` 封顶(现 1.15)。

---

## 五、下一步(按收益排序)

1. **AI 自修复闭环**:compose 后自动 dry-run,报错节点 + traceback 回传 LLM 修复(≤N 轮)。
2. **流式进度**:run 端点 SSE/WebSocket,节点逐个变绿(当前一次性返回)。
3. **磁盘缓存**:ResultCache 落 Parquet/GeoParquet,重启进程仍有效。
4. **数据感知规划**:上传文件后把 schema(列名/类型/CRS)自动写入 `data_context`(后端已支持,差前端传入)。
5. **节点 SDK**:装饰器定义节点自动生成 spec + entry_points 插件机制。
6. `gis_ingest.py` 仍是占位模板,按蓝图升级为 "LLM 生成完整 spec → 安全扫描 → 沙箱试跑 → 入库"。
7. CWL 导出目前是接口预留(`cwl_hints` + 桩端点),真正执行需 CWL runner 镜像。
8. 已知局限:多用户共享全局 store/cache(本地单用户可接受);原生文件夹对话框在无 GUI
   环境(远程/容器)返回 501 并回退应用内浏览器。
