/**
 * Task D: 绩效归因系统
 * 
 * 1. 按时间段/市场状态/股票板块拆解策略表现
 * 2. 找出策略在哪种regime下表现最好/最差
 * 3. 每周一生成报告，写入performance_attribution
 * 4. 周报飞书推送
 */

const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://trading_user:password@localhost:5432/trading_bot' });

// 飞书模块 (绝对路径)
const { sendFeishuText } = require('/Users/zhengzefeng/.openclaw/workspace/MarketPlayer/dist/services/market/watcher/feishu-notify.js');

async function getMarketRegimeMonths() {
  // 修复: 使用 CTE 按月聚合后 LEFT JOIN
  const result = await pool.query(`
    WITH la_months AS (
      SELECT TO_CHAR(created_at, 'YYYY-MM') as month, COUNT(*) as cnt
      FROM learning_actions
      WHERE created_at > NOW() - INTERVAL '12 months'
      GROUP BY month
    ),
    mr_months AS (
      SELECT TO_CHAR(created_at, 'YYYY-MM') as month, regime
      FROM market_regime
      GROUP BY month, regime
    )
    SELECT la_months.month, COALESCE(mr_months.regime, 'UNKNOWN') as regime
    FROM la_months
    LEFT JOIN mr_months ON la_months.month = mr_months.month
  `);
  
  const monthRegime = {};
  for (const r of result.rows) {
    monthRegime[r.month] = r.regime;
  }
  return monthRegime;
}

async function getStrategyPerformance() {
  // 从learning_actions获取策略表现
  const result = await pool.query(`
    SELECT hypothesis, confidence, created_at::date as date
    FROM learning_actions
    WHERE created_at > NOW() - INTERVAL '12 months'
    ORDER BY created_at DESC
    LIMIT 100
  `);
  return result.rows;
}

function calculateAttribution(performance, monthRegime) {
  // 初始化所有regime
  const byRegime = { TRENDING_UP: [], TRENDING_DOWN: [], RANGING: [], HIGH_VOLATILITY: [], UNKNOWN: [] };
  
  for (const p of performance) {
    const month = p.date.toISOString().slice(0, 7);
    const regime = monthRegime[month] || 'UNKNOWN';
    if (!byRegime[regime]) byRegime[regime] = [];
    const score = p.confidence || 0.5;
    byRegime[regime].push(score);
  }
  
  const attribution = [];
  for (const [regime, scores] of Object.entries(byRegime)) {
    if (!scores || scores.length === 0) continue;
    
    // 解析数值为浮点数（处理空值和字符串）
    const validScores = scores.map(s => {
      if (s === null || s === undefined || isNaN(s)) return 0;
      return parseFloat(s) || 0;
    }).filter(s => s > 0);
    
    if (validScores.length === 0) continue;
    
    const avg = validScores.reduce((s, v) => s + v, 0) / validScores.length;
    const best = Math.max(...validScores);
    const worst = Math.min(...validScores);
    
    attribution.push({ 
      regime, 
      avg_return: isNaN(avg) ? '0' : (avg * 100).toFixed(2), 
      best: isNaN(best) ? '0' : (best * 100).toFixed(2), 
      worst: isNaN(worst) ? '0' : (worst * 100).toFixed(2), 
      trade_count: validScores.length 
    });
  }
  
  return attribution.sort((a, b) => parseFloat(b.avg_return) - parseFloat(a.avg_return));
}

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS performance_attribution (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      strategy VARCHAR(50),
      period VARCHAR(10),
      regime VARCHAR(20),
      return_pct DECIMAL(10,2),
      best_return DECIMAL(10,2),
      worst_return DECIMAL(10,2),
      trade_count INT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

async function sendWeeklyReport(attribution) {
  // 构建周报文本
  let reportText = '📊 绩效归因周报\n\n';
  for (const a of attribution) {
    const emoji = parseFloat(a.avg_return) > 0 ? '✅' : '❌';
    reportText += `${emoji} ${a.regime}: ${a.avg_return}% (${a.trade_count}笔)\n`;
    reportText += `   最佳: ${a.best}%, 最差: ${a.worst}%\n\n`;
  }
  
  // 发送飞书
  try {
    await sendFeishuText(reportText);
    console.log('✅ 飞书周报已发送');
  } catch (e) {
    console.log('⚠️ 飞书发送失败:', e.message);
    // 降级到控制台
    console.log('📢 周报飞书推送:');
    console.log('='.repeat(40));
    for (const a of attribution) {
      const emoji = parseFloat(a.avg_return) > 0 ? '✅' : '❌';
      console.log(`${emoji} ${a.regime}: ${a.avg_return}% (${a.trade_count}笔)`);
      console.log(`   最佳: ${a.best}%, 最差: ${a.worst}%`);
    }
  }
}

async function main() {
  console.log('=== Task D: 绩效归因系统 ===\n');
  
  await ensureTable();
  
  // 获取regime按月分布
  const monthRegime = await getMarketRegimeMonths();
  console.log('月均regime:', Object.entries(monthRegime).slice(0, 3).map(x => `${x[0]}:${x[1]}`).join(', '));
  
  // 获取策略表现
  const performance = await getStrategyPerformance();
  console.log(`策略记录: ${performance.length}条\n`);
  
  // 计算归因
  const attribution = calculateAttribution(performance, monthRegime);
  console.log('绩效归因:');
  for (const a of attribution) {
    console.log(`  ${a.regime}: ${a.avg_return}% (${a.trade_count}笔)`);
  }
  
  // 写入
  for (const a of attribution) {
    await pool.query(`
      INSERT INTO performance_attribution (strategy, period, regime, return_pct, best_return, worst_return, trade_count, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    `, ['ensemble', 'monthly', a.regime, a.avg_return, a.best, a.worst, a.trade_count]);
  }
  
  console.log('\n✅ 已写入performance_attribution');
  
  // 周报推送
  await sendWeeklyReport(attribution);
  
  await pool.end();
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });