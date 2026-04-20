# 添加每日报告定时任务
echo "30 8 * * 1-5 cd $(pwd) && npx ts-node scripts/daily-strategy-report.ts >> logs/daily-report.log 2>&1"
