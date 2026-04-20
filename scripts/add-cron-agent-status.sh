#!/bin/bash
# 添加 Agent 状态汇总定时任务

CRON_TASK="*/5 * * * * cd /Users/zhengzefeng/.openclaw/workspace/MarketPlayer && node scripts/agent-status-summary.js >> logs/agent-status.log 2>&1"

# 检查是否已存在
if ! crontab -l 2>/dev/null | grep -q "agent-status-summary"; then
  (crontab -l 2>/dev/null; echo "$CRON_TASK") | crontab -
  echo "✅ 已添加 crontab: Agent 状态汇总 (每5分钟)"
else
  echo "ℹ️ crontab 已存在"
fi

# 显示当前 crontab
echo ""
echo "当前 crontab:"
crontab -l 2>/dev/null | grep "agent-status"
