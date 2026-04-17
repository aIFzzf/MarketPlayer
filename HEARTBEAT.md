# HEARTBEAT.md

## 金融团队触发链

### 高频扫描
- scan-events: 每5分钟, 开盘时段, 行情异动扫描
- scan-portfolio: 每10分钟, 开盘时段, 持仓检查

### 收盘后执行链
- cn-close: 每日 07:30 UTC (15:30 CST), A股收盘后
  链路: data→quant→backtest→evaluator→risk→fin-commander
- hk-close: 每日 08:00 UTC (16:00 HKT), 港股收盘后
  链路: 同上
- us-close: 每日 21:00 UTC (16:00 EST), 美股收盘后
  链路: 同上

### 长线复盘
- weekly-value: 每周六 02:00 UTC (10:00 CST), 长线估值复盘

---

## 开发团队触发链

### app-agent 竞品调研（每日 07:00 CST）
- 搜索 GitHub 上的 AI 投资助手、量化框架最新动态
- 分析竞品新功能和架构变化
- 输出调研摘要写入 memory-store
- 有重要发现时推送飞书通知给 dev-commander

### dev-learning-agent 工程优化（每周一 09:00 CST）
- 基于竞品调研结果和本周开发记录
- 生成工程优化建议和重构方向
- 写入 memory-store
- 推送周报给 dev-commander

### 每日 22:00 代码验证与提交
- 运行编译检查
- 检查数据文件完整性
- Git commit + push
- 结果写入 audit_log

---

## crontab 配置

```bash
# 高频扫描
*/5 * * * * node agents/harness/trigger-engine/scan-events.js

# Agent 状态汇总 (每5分钟)
*/5 * * * * node scripts/agent-status-summary.js

# A股收盘后 (15:30 CST = 07:30 UTC)
30 7 * * 1-5 node agents/harness/trigger-engine/daily-trigger.js A股

# 港股收盘后 (16:00 HKT = 08:00 UTC)  
00 8 * * 1-5 node agents/harness/trigger-engine/daily-trigger.js 港股

# 美股收盘后 (16:00 EST = 21:00 UTC)
00 21 * * 1-5 node agents/harness/trigger-engine/daily-trigger.js 美股

# 每周六复盘 (10:00 CST = 02:00 UTC)
00 2 * * 6 node agents/harness/trigger-engine/weekly-review.js

# 每月估值 (09:00 CST = 01:00 UTC)
00 1 1 * * node agents/harness/trigger-engine/monthly-value.js
```

---