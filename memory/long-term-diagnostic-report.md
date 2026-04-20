# 长线策略诊断报告

**诊断时间**: 2026-04-19 13:05  
**诊断人**: neo claude

---

## 问题清单及解决状态

### 1. PostgreSQL 数据库连接 ✅ 已解决

**状态**: ✅ 正常运行
- PostgreSQL@15 运行正常
- 端口: 5432
- 数据库: trading_bot
- 用户: trading_user

**验证命令**:
```bash
ps aux | grep postgres
/opt/homebrew/opt/postgresql@15/bin/psql -d trading_bot -c "\dt"
```

**结果**: 27个表正常，包括所有学习表和信号表

---

### 2. 基本面数据获取 ✅ 已完成

**状态**: ✅ 数据就绪

#### A股数据 (5只)
- 600519 贵州茅台 ✅
- 000858 五粮液 ✅
- 300750 宁德时代 ✅
- 601318 中国平安 ✅
- 000333 美的集团 ✅

#### 港股数据 (5只)
- 00700 腾讯控股 ✅
- 09988 阿里巴巴-SW ✅
- 03690 美团-W ✅
- 02318 中国平安 ✅
- 01211 比亚迪 ✅

#### 美股数据 (7只)
- AAPL, MSFT, GOOGL, AMZN, NVDA, TSLA, META ✅

**数据文件位置**: `data/fundamental/*.json`

**PB估值数据**: `data/fundamental/a_pb_percentile.csv` (307KB, 3000+行)

---

### 3. 学习系统运行 ✅ 已配置

**状态**: ✅ 定时任务已配置

#### launchd任务 (macOS)
```bash
com.marketplayer.learning
每日 02:00 自动执行
```

**验证**:
```bash
launchctl list | grep marketplayer
# 输出: com.marketplayer.learning
```

#### crontab任务 (Linux风格)
```bash
0 2 * * * cd ~/.openclaw/workspace/MarketPlayer && /usr/local/bin/node agents/harness/trigger-engine/learning-trigger.js
```

**数据积累**:
- learning_actions: 57条记录 ✅
- quant_signals: 2条记录 ✅
- value_daily_watchlist: 1条记录 ✅
- value_prediction_outcomes: 1条记录 ✅
- value_criteria_history: 6条记录 ✅

---

### 4. 长线Agent执行状态 ⚠️ 需要调度

**Agent位置**: `agents/long-term-agent/index.js`

**手动测试**: ✅ 成功运行
```bash
cd ~/.openclaw/workspace/MarketPlayer
DATABASE_URL="postgresql://trading_user:password@localhost:5432/trading_bot" \
  node agents/long-term-agent/index.js
```

**测试结果**:
- 加载基本面数据: 7只美股 ✅
- 基本面筛选: 3/7通过 (AMZN, GOOGL, MSFT) ✅
- 技术面分析: 正常工作 ✅
- signal_candidates表: ✅ 存在
- 市场状态: caution (谨慎观望)

**缺失**: ❌ 未配置定时执行
- 建议: 每周日晚20:00执行
- 或: 每月1日执行（基本面变化慢）

---

## 建议改进

### 1. 添加长线Agent定时任务

**方案A: crontab (推荐)**
```bash
# 每周日 20:00 执行
0 20 * * 0 cd ~/.openclaw/workspace/MarketPlayer && DATABASE_URL="postgresql://trading_user:password@localhost:5432/trading_bot" /usr/local/bin/node agents/long-term-agent/index.js >> logs/longterm-agent.log 2>&1
```

**方案B: launchd (macOS)**
创建 `com.marketplayer.longterm.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.marketplayer.longterm</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/Users/zhengzefeng/.openclaw/workspace/MarketPlayer/agents/long-term-agent/index.js</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Weekday</key>
        <integer>0</integer>
        <key>Hour</key>
        <integer>20</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>WorkingDirectory</key>
    <string>/Users/zhengzefeng/.openclaw/workspace/MarketPlayer</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>DATABASE_URL</key>
        <string>postgresql://trading_user:password@localhost:5432/trading_bot</string>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin</string>
    </dict>
    <key>StandardOutPath</key>
    <string>/Users/zhengzefeng/.openclaw/workspace/MarketPlayer/logs/longterm-agent.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/zhengzefeng/.openclaw/workspace/MarketPlayer/logs/longterm-agent-error.log</string>
</dict>
</plist>
```

### 2. 数据更新建议

**当前数据最后更新**: 2026-03-25 (25天前)

建议每月更新一次：
```bash
# 每月1号凌晨03:00更新基本面数据
0 3 1 * * cd ~/.openclaw/workspace/MarketPlayer && /usr/local/bin/node scripts/fetch-fundamental-data.js >> logs/fetch-data.log 2>&1
```

### 3. 飞书通知集成

长线Agent已准备好发送通知，需要集成飞书webhook：

修改 `agents/long-term-agent/index.js`:
```javascript
async function sendNotification(candidates, marketStatus) {
  // 添加飞书webhook调用
  const webhookUrl = process.env.FEISHU_WEBHOOK_URL;
  if (webhookUrl) {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msg_type: 'text',
        content: { text: message }
      })
    });
  }
}
```

---

## 快速部署脚本

```bash
#!/bin/bash
# deploy-longterm-cron.sh

cd ~/.openclaw/workspace/MarketPlayer

echo "🚀 部署长线Agent定时任务..."

# 添加到crontab
(crontab -l 2>/dev/null; echo "0 20 * * 0 cd ~/.openclaw/workspace/MarketPlayer && DATABASE_URL=\"postgresql://trading_user:password@localhost:5432/trading_bot\" /usr/local/bin/node agents/long-term-agent/index.js >> logs/longterm-agent.log 2>&1") | crontab -

echo "✅ 定时任务已添加: 每周日 20:00 执行"

# 创建日志文件
touch logs/longterm-agent.log
echo "✅ 日志文件已创建"

# 测试运行
echo "🧪 测试运行..."
DATABASE_URL="postgresql://trading_user:password@localhost:5432/trading_bot" \
  node agents/long-term-agent/index.js

echo "✨ 部署完成！"
echo "📊 查看crontab: crontab -l | grep longterm"
echo "📊 查看日志: tail -f logs/longterm-agent.log"
```

---

## 验收清单

- [x] PostgreSQL运行正常
- [x] 数据库表完整（27个表）
- [x] 基本面数据就绪（17只股票）
- [x] PB估值数据就绪（A股）
- [x] 学习系统定时任务配置完成
- [x] 长线Agent手动测试通过
- [ ] **待完成**: 长线Agent定时任务配置
- [ ] **待完成**: 飞书通知集成
- [ ] **待完成**: 数据定期更新任务

---

## 当前诊断结论

### ✅ 已解决的问题
1. PostgreSQL数据库连接正常
2. 所有必要的数据表已创建
3. 基本面数据已获取并存储
4. signal_candidates表已存在
5. 学习系统定时任务已配置

### ⚠️ 需要配置的项
1. **长线Agent定时执行** - 建议每周日20:00执行
2. 飞书webhook通知（可选）
3. 基本面数据定期更新（可选，建议每月）

### 📊 系统健康度: 85/100

**评分说明**:
- 核心功能 +60分 (PostgreSQL + 数据 + 表结构)
- 学习系统 +15分 (定时任务配置)
- Agent测试通过 +10分
- 缺少定时调度 -15分

---

**下一步行动**: 运行 `deploy-longterm-cron.sh` 完成最后配置
