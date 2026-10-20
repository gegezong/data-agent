# DataAgent 文档

本目录同时保存当前保守稳定版本和最终目标产品设计。阅读顺序建议是：先看当前实现，再看工具与事件，再看目标产品和目标架构。

## 当前保守稳定版本

- [当前产品设计](./product-design.md)：说明当前已落地的用户场景、CSV/SQLite 数据层、三个分析工具、SSE 和后续规划。
- [当前技术架构](./technical-architecture.md)：说明当前 Pi Agent 集成、工具、扩展、权限、测试和运行方式。
- [工具目录](./tools-catalog.md)：完整说明当前三个业务工具的参数、返回结构、权限边界和扩展路线。
- [扩展事件目录](./extension-events.md)：完整说明 Pi Agent 生命周期、`tool_call` 安全扩展和 SSE 事件映射。
- [分析闭环](./analysis-loop.md)：说明保守版本的 Planner、Tool Executor、Verifier、`calculationId`、Evidence 和 SSE 事件链路。

当前保守版本已经落地 `query_sales`、`compare_periods`、`breakdown_metric` 三个只读工具，以及指标目录、权限双重校验、基础 Planner、Tool Executor、Verifier、Evidence 关联和 SSE 流式展示。复杂 Replan、分析快照持久化和 PostgreSQL 等内容仍属于后续演进。

## 目标成品

- [目标产品设计](./target-product-design.md)：重新定义为销售经营分析 Copilot，说明 Agent 的核心价值、用户体验、工具箱、产品分期和面试表达。
- [目标技术架构](./target-technical-architecture.md)：说明 Planner、Tool Executor、Verifier、Composer、语义指标层、证据链、事件协议、评测和生产演进。

当前版本是可运行的保守稳定版本，不应包装成目标成品。目标文档描述的是下一阶段要逐步实现的成熟形态，迁移表说明如何在现有代码上演进而不是推倒重来。
