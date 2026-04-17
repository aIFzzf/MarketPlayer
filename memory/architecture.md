# MarketPlayer 架构文档

## 项目概览

- **名称**: MarketPlayer
- **类型**: AI Trading Assistant for Chinese Investors
- **路径**: `/Users/zhengzefeng/.openclaw/workspace/MarketPlayer`
- **技术栈**: Node.js + TypeScript + PostgreSQL + Redis

## 目录结构

```
MarketPlayer/
├── agents/                    # Agent 团队
│   ├── fin-chain/              # 金融团队
│   │   ├── data-agent/         # 数据收集
│   │   ├── quant-agent/        # 量化策略
│   │   ├── backtest-agent/     # 回测验证
│   │   ├── risk-agent/          # 风控审核
│   │   ├── evaluator-agent/      # 策略评估
│   │   └── strategy-learning-agent/  # 学习闭环
│   ├── news-monitor/            # 新闻监控 (Python)
│   ├── harness/                # 执行引擎
│   │   ├── trigger-engine/      # 触发器
│   │   ├── routing-policy/      # 路由决策
│   │   └── state-machine/      # 状态机
│   └── detectors/               # 异常检测
│
├── src/                        # 主服务
│   ├── api/                    # Express API
│   ├── services/               # 业务服务
│   │   ├── market/             # 市场数据
│   │   ├── sentiment/           # 情绪分析
│   │   ├── backtest/           # 回测引擎
│   │   └── notify/              # 通知服务
│   ├── queues/                 # BullMQ 队列
│   ├── sockets/                # WebSocket
│   └── db/                     # 数据库连接
│
├── scripts/                    # 脚本工具
│   ├── daily-strategy-report.ts  # 每日报告
│   ├── market-status-writer.js    # 市场状态写入
│   └── multi-strategy-learning.ts # 多策略学习
│
├── data/                      # 数据目录
│   ├── cache/klines/         # K线数据 (us_*.json)
│   └── fundamental/          # 基本面数据
│
├── public/                    # 前端页面
│   ├── panel-*.html          # 各种面板
│   └── dashboard.html        # 主仪表盘
│
└── logs/                     # 日志目录
```

## 核心服务

### API 服务 (端口 3000)
- `src/index.ts` - 主入口
- `src/api/server.ts` - Express + Socket.IO

### MCP 服务
- `src/mcp/server.ts` - MCP 工具服务器

### 数据库
- PostgreSQL: `trading_bot` (DATABASE_URL)
- Redis: 消息队列 (REDIS_URL)

## 关键表结构

| 表名 | 用途 |
|------|------|
| `signals` | 交易信号 |
| `orders` | 订单记录 |
| `strategy_positions` | 持仓 |
| `market_status` | 市场状态 |
| `sentiment_history` | 情绪历史 |
| `backtest_runs` | 回测记录 |
| `learning_actions` | 学习动作 |
| `news_items` | 新闻数据 |

## 定时任务 (Crontab)

| 时间 | 任务 |
|------|------|
| */5 * * | 高频扫描 |
| 09:15 | A股/港股开盘 |
| 15:05 | A股收盘 |
| 16:05 | 港股收盘 |
| 21:15 | 美股开盘 |
| 05:15 | 美股收盘 |
| 08:30 | 每日报告 |
| 20:00 (日) | 学习总结 |
| 02:00 (日) | 每日学习 |

## 飞书配置

- APP_ID: `cli_a927ea1b10385bd7`
- 用户: `ou_3d8c36452b5a0ca480873393ad876e12`

## 环境变量 (.env 关键项)

```
DATABASE_URL=postgresql://trading_user:password@localhost:5432/trading_bot
REDIS_URL=redis://localhost:6379
PORT=3000
```

---

*最后更新: 2026-04-12*
*来源: MEMORY.md 架构章节*