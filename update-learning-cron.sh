#!/bin/bash
# 更新学习系统定时任务为优化版

cd ~/.openclaw/workspace/MarketPlayer

echo "🔄 更新学习系统定时任务..."

# 移除旧的learning任务，添加新的优化学习任务
(crontab -l 2>/dev/null | grep -v "learning-trigger.js"; echo "0 2 * * 6 cd ~/.openclaw/workspace/MarketPlayer && npx tsx scripts/optimized-learning.ts >> logs/optimized-learning.log 2>&1") | crontab -

echo "✅ 定时任务已更新: 每周六 02:00 运行优化学习"

echo ""
echo "📊 当前学习相关定时任务:"
crontab -l | grep -E "learning|longterm"

echo ""
echo "🎯 agent状态:"
/opt/homebrew/opt/postgresql@15/bin/psql -d trading_bot -c "SELECT agent_name, status, metrics->>'avg_sharpe' as sharpe FROM agent_status WHERE agent_name='learning-agent';" 2>/dev/null

echo ""
echo "✨ 更新完成！"
echo ""
echo "📌 下次执行: 本周六 02:00"
echo "📌 查看日志: tail -f logs/optimized-learning.log"
echo "📌 手动运行: npx tsx scripts/optimized-learning.ts"
