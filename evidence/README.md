# 事件证据库（Evidence）— "信号 → 参数"人工审核闸

每日雷达（daily-hot-radar / life-pulse-radar）只负责**采集事实与候选信号**，
**不直接改变模型参数**。任何"新闻/事件 → 经济影响"的推断都必须经过本目录的人工审核，
审核通过后才允许发布为参数版本（`params.json`）。

## 原则（和模型口径一致）

1. **事件不自动改参数**：一条"签约 XX 亿"的新闻 ≠ XX 亿年度产值。必须识别投资额、
   产能、投产年份、达产比例、是否计入既有项目，才能判断对哪个情景、影响多少。
2. **parameter_change 初始为 null**：采集来的候选事件只登记事实，不登记影响。
3. **人工审核才入库**：只有 `status: "approved"` 且 `parameter_change` 非空的事件，
   才能被 `tests/release_params.js` 发布进 `params.json`。
4. **可回滚**：每个发布的参数版本记录生成时间、事件 ID 与原因；旧版本可对比、可回退。

## 事件文件字段（evidence/events/*.json）

| 字段 | 类型 | 说明 |
|---|---|---|
| event_id | string | 唯一 ID，如 `HD-2026-0001` |
| region | string | 惠阳 |
| event_type | string | project_progress / investment / policy / transport / industry_shift / disaster / other |
| subject | string | 事件主体/一句话标题 |
| event_date | string\|null | 事件发生日期（YYYY-MM-DD），未知为 null |
| published_at | string\|null | 报道发布时间，未知为 null |
| fetched_at | string | 被雷达抓取时间（YYYY-MM-DDTHH:MM:SS） |
| source_url | string | 原始来源 URL（必填，红线：不杜撰） |
| evidence_level | string | A 官方直接观测 / B 间接推算 / C 模型校准参数 / D 未验证假设 |
| status | string | pending（待审）/ approved（已通过）/ rejected（驳回） |
| related_paths | string[] | 可能影响的情景或路径，如 `["filmProgress"]`、`[0]` |
| parameter_change | object\|null | 审核后填：`{"target":"...","delta":..,"reason":"..."}`；未审核为 null |
| requires_review | boolean | parameter_change 非空时必须为 true |
| review | object | `{"reviewer":null,"reviewed_at":null,"comment":null}`，审核人填写 |

路径 index 对应 `model.js` 的 `DEFAULT_PATHS`（各路径按仓库模型而定）；
`parameter_change` 采用 `{"path_index":0,"mu_delta":50,"reason":"..."}` 形式。

## 工作流

```
雷达抓取 → evidence/events/<id>.json（status=pending, parameter_change=null）
                ↓ 人工审核（对照 source_url 与 evidence_level）
       approved（填 parameter_change + review）
                ↓
   node tests/release_params.js → 生成 params.json（版本化，含 change 记录）
                ↓（下一步）
   页面加载 params.json 覆盖默认参数（未接入前先人工核对 diff）
```

## 红线

- 不杜撰：source_url 必须真实可访问；搜不到就不建事件。
- 估算必标注：parameter_change 的 reason 写清推算口径与证据等级。
- 未经审核的事件（pending/rejected）永远不进入 params.json。
