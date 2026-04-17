/**
 * Agent 状态汇总 - 定时任务版本
 * 支持手动和定时运行
 * 
 * Crontab: 每5分钟执行 node scripts/agent-status-summary.js
 */

const { Client } = require('pg');
const client = new Client({ host: 'localhost', port: 5432, user: 'trading_user', password: 'password', database: 'trading_bot' });

const AGENTS = [
  'commander',
  'quant-agent', 
  'learning-agent',
  'data-agent',
  'market-agent',
  'value-agent',
  'dev-agent',
  'ops-agent',
  'fin-commander',
  'dev-commander'
];

async function main() {
  await client.connect();
  
  console.log('');
  console.log('┌' + '─'.repeat(60) + '┐');
  console.log('│' + ' 📊 MarketPlayer Agent 状态汇总 '.padEnd(60) + '│');
  console.log('├' + '─'.repeat(60) + '┤');
  console.log('│ 生成时间: ' + new Date().toLocaleString('zh-CN').padEnd(38) + '│');
  console.log('└' + '─'.repeat(60) + '┘');
  console.log('');
  
  // 1. 各 Agent 状态
  console.log('【Agent 状态】');
  console.log('─'.repeat(60));
  
  const agents = await client.query('SELECT * FROM agent_status ORDER BY last_active DESC');
  
  if (agents.rows.length === 0) {
    console.log('⚠️ 暂无状态记录，请各 agent 调用 agent-heartbeat.js 更新状态');
  } else {
    agents.rows.forEach(x => {
      const ago = Math.floor((Date.now() - new Date(x.last_active).getTime()) / 60000);
      const statusIcon = x.status === 'active' ? '🟢' : x.status === 'idle' ? '🟡' : '⚪';
      console.log(`${statusIcon} ${x.agent_name.padEnd(15)} | ${(x.status || '-').padEnd(10)} | 任务: ${x.last_task || '-'} | ${ago}分钟前`);
    });
  }
  console.log('');
  
  // 2. 系统指标
  console.log('【系统指标】');
  console.log('─'.repeat(60));
  
  const bt = await client.query('SELECT COUNT(*) as cnt, AVG(sharpe_ratio::numeric) as avg FROM backtest_runs');
  const la = await client.query('SELECT COUNT(*) as cnt FROM learning_actions');
  const pos = await client.query("SELECT COUNT(*) as cnt FROM strategy_positions WHERE status = 'open'");
  
  console.log(`📈 回测次数: ${bt.rows[0].cnt} | 平均 Sharpe: ${parseFloat(bt.rows[0].avg || 0).toFixed(2)}`);
  console.log(`📚 学习记录: ${la.rows[0].cnt}`);
  console.log(`💰 当前持仓: ${pos.rows[0].cnt}`);
  console.log('');
  
  // 3. 当前持仓
  console.log('【持仓明细】');
  console.log('─'.repeat(60));
  const positions = await client.query("SELECT symbol, pnl_pct FROM strategy_positions WHERE status = 'open'");
  if (positions.rows.length === 0) {
    console.log('  (无持仓)');
  } else {
    positions.rows.forEach(x => console.log(`  • ${x.symbol}: PnL ${x.pnl_pct}%`));
  }
  console.log('');
  
  // 4. 最近学习
  console.log('【最近学习】');
  console.log('─'.repeat(60));
  const learnings = await client.query('SELECT hypothesis, confidence FROM learning_actions ORDER BY created_at DESC LIMIT 3');
  learnings.rows.forEach(x => console.log(`  • ${x.hypothesis.substring(0,40)} (置信度: ${x.confidence})`));
  console.log('');
  
  // 5. 待办事项
  console.log('【待办事项】');
  console.log('─'.repeat(60));
  console.log('  ⚠️ crontab 定时执行策略学习闭环 - 等待确认');
  console.log('  ⚠️ 升级条件: 连续5次平均 Sharpe > 3.27 (当前 1.16)');
  console.log('');
  
  console.log('─'.repeat(60));
  console.log('报告完成');
  console.log('');
  
  await client.end();
}

main().catch(e => console.error(e.message));
