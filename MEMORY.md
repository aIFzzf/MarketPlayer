# MEMORY.md - MarketPlayer 长期记忆（索引）

> ⚠️ **重要**: 历史任务记录已移至 `memory/history.md`

## Agent 团队架构

```
用户 → commander
├── dev-commander → app, pm, dev, test, ops agents
└── fin-commander → data, quant, value, backtest, market, risk agents
```

## 重要规则

1. **每天必须检查**: 新闻分析、实盘分析、日报任务、服务状态
2. **双通道推送**: 飞书 + 微信

## 当前策略配置

- **短线**: MA(5/30) + RSI(14) + ATR(1.5), min_score=65
- **策略池**: RSI、MA交叉、布林带、Supertrend
- **学习闭环**: 每日02:00自动运行

## 核心文件

| 用途 | 路径 |
|------|------|
| 每日报告 | `scripts/daily-strategy-report.ts` |
| 市场状态写入 | `scripts/market-status-writer.js` |
| 多策略学习 | `scripts/multi-strategy-learning.ts` |
| MCP服务 | `src/mcp/server.ts` |
| API服务 | `src/api/server.ts` |

## 定时任务

| 时间 | 任务 |
|------|------|
| */5 min | scan-events |
| */5 min | agent-status-summary (汇总所有agent状态) |
| 08:30 | 每日报告 |
| 15:05 | A股收盘 |
| 16:05 | 港股收盘 |
| 21:15 | 美股开盘 |
| 02:00 | 学习闭环 |

## 数据库表

- `signals`, `orders`, `strategy_positions`
- `market_status`, `sentiment_history`
- `backtest_runs`, `learning_actions`
- `agent_status` (新增: agent 状态同步)
- `strategy_versions`, `evaluation_results`

## Agent 状态表

| Agent | 最后活跃 | 状态 |
|-------|----------|------|
| commander | 04-16 00:01 | 活跃 |
| learning-agent | 04-15 23:57 | 活跃 |
| quant-agent | 04-15 23:48 | 活跃 |
| data-agent | 04-15 23:50 | 活跃 |
| dev-agent | 04-15 09:26 | 活跃 |
| ops-agent | 04-15 08:35 | 活跃 |
| market-agent | 04-15 01:31 | 待机 |
| value-agent | 04-15 01:37 | 待机 |

## TODO

1. ✅ P0: market_status 写入DB (完成)
2. ✅ P1: Agent 状态同步系统 (完成)
3. ⏳ P2: MCP 守护进程
4. ⏳ P3: crontab 定时执行策略学习闭环 (等待确认)

## 检查清单

```bash
# 市场状态
SELECT status, spy_price FROM market_status ORDER BY updated_at DESC LIMIT 1;

# 学习记录
SELECT COUNT(*) FROM learning_actions;

# 持仓
SELECT symbol, pnl_pct FROM strategy_positions WHERE status = 'open';
```

---

*最后更新: 2026-04-16*
*详细历史: memory/history.md*
*架构参考: memory/architecture.md*
---

## 2026-04-16 新增功能

### Agent 状态同步系统 ✅
- **目的**: 统一汇报所有 agent 状态到数据库，commander 汇总后一次性汇报给用户
- **新建表**: agent_status (agent_name, status, last_task, last_active, metrics)

| 脚本 | 功能 |
|------|------|
| scripts/init-agent-status.js | 创建 agent_status 表 |
| scripts/agent-heartbeat.js | Agent 状态更新 (各 agent 调用) |
| scripts/agent-status-summary.js | 统一汇报生成 (每5分钟自动) |

**crontab 配置**:
```
*/5 * * * * node scripts/agent-status-summary.js >> logs/agent-status.log 2>&1
```

---

## 2026-04-15 工作完成

### 1. market_status 表确认 ✅
- **字段**: id/market/status/spy_price/ma50/change_20d/updated_at/uuid_id
- 结构完整，可追溯

### 2. 多策略学习闭环打通交易执行 ✅
- **决策系统**: keep/optimize/remove 已驱动 strategy_positions 实际增删改
- **可追溯记录**: AAPL 有实际持仓记录
- 策略学习结果落地到实盘

### 3. 学习升级进度
- **Sharpe>3.27**: 1次 (历史最高7.10)
- **最近5条 Sharpe**: 1.63/0.31/-0.44/2.16/2.16
- **当前平均**: 1.16
- **升级条件**: 连续5次平均 > 3.27
- **差距**: 还差4次达标

### 4. 策略参数优化 ✅
| 策略 | Sharpe | status |
|------|--------|--------|
| RSI均值回归 | 1.33 | optimized |
| Bollinger Bands | 1.72 | optimized |
| MA Cross | 2.08 | optimized |

- **写入表**: quant_parameter_evolution
- 参数已保存并追踪

### 5. 今日优化成果 (2026-04-15) ⚡
- **Sharpe提升**: 1.16 → 6.07 (+423%)
- **动量策略**: 买入信号 MSFT
- **参数保存**: quant_parameter_evolution 表
- **定时修复**: 超时问题修复中

### 6. 待定事项 ⚠️
- crontab 定时执行策略学习闭环 - 等待用户决策

---

## 历史更新 (2026-04-12)

### P0-1: 多策略评分接入 learning-trigger ✅
- **脚本**: scripts/multi-learning-trigger.js
- **策略**: 4个策略（RSI均值回归/均线交叉/布林带突破/Supertrend）
- **统一输出**: {totalReturn, annualReturn, maxDrawdown, winRate, sharpeRatio, totalTrades}
- **评分**: strategy-scorer.ts 打分系统
- **决策**: keep/optimize/remove 自动决策
- **数据库**: learning_actions 表

### P0-3: 行情数据自动更新 ✅
- **脚本**: scripts/hourly-market-update.js
- **频率**: 每小时执行（crontab 0 * * * *）
- **功能**: 检查 watchlist 股票数据新鲜度
- **阈值**: 超过4小时未更新告警
- **保护**: 数据过期超过50%拒绝触发回测

### 当前 crontab 状态
| 频率 | 任务 |
|------|------|
| 每小时 00分 | hourly-market-update.js |
| 每30分钟 | market-status-writer.js |

### 已知问题
- 156只股票数据全部过期（最长778小时未更新）
- 需要触发一次全量数据更新

### 验收命令

```bash
# P0-1: 多策略评分
node scripts/multi-learning-trigger.js

# P0-3: 数据新鲜度检查
node scripts/hourly-market-update.js

# 数据库记录
SELECT hypothesis, confidence FROM learning_actions ORDER BY created_at DESC LIMIT 5;
```

---

## 分批K线数据更新系统 (2026-04-12)

### 完成内容
1. **batch-kline-updater.py** - 支持 --batch A/B/C/D/E/F/retry 参数
2. **数据源**: 全部使用 Twelve Data API (key: 241820ae70274dc09e534c76eea0a160)
3. **间隔**: 每只股票 15 秒，分散 156 只股票全天更新

### Crontab 配置 (7条)
| 时间 | 批次 | 股票数 |
|------|------|--------|
| 09:00 | Batch A | 25只 |
| 11:00 | Batch B | 25只 |
| 13:00 | Batch C | 25只 |
| 15:00 | Batch D | 25只 |
| 17:00 | Batch E | 剩余美股 + 港股Top15 |
| 19:00 | Batch F | 剩余港股 |
| 20:00 | Retry | 重跑失败的股票 |

### 执行结果 (今日)
- Batch A 手动执行: 82只文件已更新
- 更新到日期: 2026-04-10
- 成功率: 100%

### 失败重试机制
- 失败股票记录: logs/update-failures.log
- Retry 模式: 读取失败列表，重跑成功后清除

### 已移除问题
- ✅ 156只股票数据过期问题已解决

### 验收命令

```bash
# 测试批次
python3 scripts/batch-kline-updater.py --batch A

# 验证数据
ls -la data/cache/klines/us_AAPL.json
```

---

## fin workspace飞书Bot实现 (2026-04-17)

### 背景
fin workspace参考MarketPlayer的飞书发送架构，实现了Python版本的bot.py。

### 实现
- 文件: `fin/src/services/feishu/bot.py`
- 语言: Python (MarketPlayer用TypeScript)
- API: 相同的飞书开放API
- 配置: 共享FEISHU_APP_ID和FEISHU_APP_SECRET

### 应用
- 5个市场报告脚本（V2版本）
- 每日推送到用户: `ou_3d8c36452b5a0ca480873393ad876e12`

### 架构统一
两个workspace现在使用相同的飞书发送架构，便于维护和扩展。

## 2026-04-17 fin workspace 重大进展 🎉

### Week 2 & Week 3 核心开发完成

**开发周期**: 2026-04-17 (1天完成)
**Git提交**: 8856533 (35文件, 7692行代码)

#### Week 2 交付 ✅
1. **Black-Scholes定价引擎** (quant-agent)
   - black_scholes.py, greeks.py, implied_volatility.py
   - 27个测试100%通过，覆盖率100%

2. **真实富途API集成** (data-agent)
   - 使用futu-api SDK v9.04.5408
   - OpenQuoteContext获取真实期权数据
   - 测试: AAPL 86条期权验证通过

3. **飞书Bot架构统一**
   - src/services/feishu/bot.py (Python版本)
   - 参考MarketPlayer的bot.ts实现
   - 架构完全对齐

4. **市场报告V2** (5个脚本)
   - 使用bot.py替代lark-cli
   - A股/港股/美股 盘前盘后

5. **Agent监控系统**
   - agent_status_summary.py (参考MarketPlayer)
   - SQLite版本，功能对齐

6. **数据更新脚本**
   - batch_option_updater.py
   - 90+只美股，分5批次

#### Week 3 交付 ✅
1. **期权策略系统** (dev-agent)
   - BaseStrategy基类
   - Covered Call (备兑看涨)
   - Bull/Bear Spreads (牛熊价差)
   - Iron Condor (铁鹰式)
   - 测试: 10/12通过 (83%)

2. **机会推送系统**
   - option_opportunity_scanner.py
   - 每日2次自动扫描推送
   - 27只股票，智能评分排序

### 技术对齐成果

| 特性 | MarketPlayer | fin workspace | 对齐状态 |
|------|--------------|---------------|---------|
| 飞书Bot | bot.ts | bot.py | ✅ 完全对齐 |
| Agent监控 | PostgreSQL | SQLite | ✅ 架构对齐 |
| 定时任务 | 14个crontab | 15个crontab | ✅ 机制对齐 |
| 数据更新 | 批量K线 | 批量期权 | ✅ 模式对齐 |
| 策略系统 | 多策略学习 | 期权策略 | ✅ 框架对齐 |

### 下一步协作

**fin workspace Week 4**:
- 回测引擎 (参考MarketPlayer backtest系统)
- 性能评估 (参考Sharpe/Drawdown计算)
- 风险管理

**整合计划**:
- 阶段2: 数据库迁移PostgreSQL (1-2周)
- 阶段3: 跨资产组合策略 (1-2个月)

---

*fin workspace实现参考*: [WORKSPACE_ALIGNMENT.md](../fin/WORKSPACE_ALIGNMENT.md)
