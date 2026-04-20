#!/bin/bash
# 更新定时任务为简化版学习系统（2策略）

cd ~/.openclaw/workspace/MarketPlayer

echo "🔄 更新学习系统定时任务为简化版..."

# 备份当前crontab
crontab -l > crontab-backup-$(date +%Y%m%d-%H%M).txt
echo "✅ 已备份crontab"

# 移除旧的learning任务，添加新的简化学习任务
(crontab -l 2>/dev/null | grep -v "multi-strategy-learning\|optimized-learning"; \
 echo "0 2 * * * cd ~/.openclaw/workspace/MarketPlayer && npx tsx scripts/simplified-learning.ts >> logs/simplified-learning.log 2>&1") | crontab -

echo "✅ 定时任务已更新"

echo ""
echo "📊 当前学习相关定时任务:"
crontab -l | grep -E "learning|longterm|strategy"

echo ""
echo "🧪 测试运行简化学习..."
npx tsx scripts/simplified-learning.ts 2>&1 | tail -30

echo ""
echo "✨ 更新完成！"
echo ""
echo "📌 下次执行: 明天 02:00"
echo "📌 查看日志: tail -f logs/simplified-learning.log"
echo "📌 手动运行: npx tsx scripts/simplified-learning.ts"
