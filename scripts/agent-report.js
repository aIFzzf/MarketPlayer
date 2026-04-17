/**
 * Agent 状态汇总报告
 * Commander 调用此脚本生成统一汇报
 */

const { Client } = require('pg');
const client = new Client({ host: 'localhost', port: 5432, user: 'trading_user', password: 'password', database: 'trading_bot' });

async function main() {
  await client.connect();
  
  console.log('='.repeat(50));
  console.log('📊 Agent 状态汇总报告');
  console.log('='.repeat(50));
  console.log(`生成时间: ${new Date().toISOString()}`);
  console.log('');
  
  // 1. Agent 状态
  console.log('=== Agent 状态 ===');
  const agents = await client.query('SELECT agent_name, status, last_task, last_active FROM agent_status ORDER BY last_active DESC');
  agents.rows.forEach(x => {
    const ago = Math.floor((Date.now() - new Date(x.last_active).getTime()) / 60000);
    console.log(`• ${x.agent_name}: ${x.status} | 任务: ${x.last_task || '-'} | ${ago}分钟前`);
  });
  console.log('');
  
  // 2. 系统指标
  console.log('=== 系统指标 ===');
  const bt = await client.query('SELECT COUNT(*) as cnt, AVG(sharpe_ratio::numeric) as avg FROM backtest_runs');
  console.log(`• 回测次数: ${bt.rows[0].cnt}`);
  console.log(`• 平均Sharpe: ${parseFloat(bt.rows[0].avg || 0).toFixed(2)}`);
  
  const la = await client.query('SELECT COUNT(*) as cnt FROM learning_actions');
  console.log(`• 学习记录: ${la.rows[0].cnt}`);
  
  const pos = await client.query("SELECT COUNT(*) as cnt FROM strategy_positions WHERE status = 'open'");
  console.log(`• 当前持仓: ${pos.rows[0].cnt}`);
  console.log('');
  
  // 3. 持仓详情
  console.log('=== 当前持仓 ===');
  const positions = await client.query("SELECT symbol, pnl_pct FROM strategy_positions WHERE status = 'open'");
  if (positions.rows.length === 0) {
    console.log('(无持仓)');
  } else {
    positions.rows.forEach(x => console.log(`• ${x.symbol}: PnL ${x.pnl_pct}%`));
  }
  console.log('');
  
  // 4. 最近学习
  console.log('=== 最近学习 (3条) ===');
  const learnings = await client.query('SELECT hypothesis, confidence FROM learning_actions ORDER BY created_at DESC LIMIT 3');
  learnings.rows.forEach(x => console.log(`• ${x.hypothesis.substring(0,35)} (C:${x.confidence})`));
  console.log('');
  
  // 5. 待定事项
  console.log('=== 待定事项 ===');
  console.log('• crontab 定时执行策略学习闭环 - 等待确认');
  console.log('• 升级条件: 连续5次平均Sharpe > 3.27 (当前 1.16)');
  console.log('');
  
  console.log('='.repeat(50));
  console.log('报告结束');
  console.log('='.repeat(50));
  
  await client.end();
}

main().catch(e => console.error(e.message));
