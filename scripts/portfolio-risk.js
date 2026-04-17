/**
 * Task C: 组合层风控
 * 
 * 1. 计算持仓股票两两相关性
 * 2. 规则: 单策略亏损>5%暂停, 相关性>0.8降级, 集中度>40%告警
 * 3. 每天08:00运行，写入portfolio_risk
 * 4. 有告警飞书推送
 */

const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://trading_user:password@localhost:5432/trading_bot' });

// 飞书模块 (绝对路径)
const { sendFeishuText } = require('/Users/zhengzefeng/.openclaw/workspace/MarketPlayer/dist/services/market/watcher/feishu-notify.js');

const DATA_DIR = '/Users/zhengzefeng/.openclaw/workspace/MarketPlayer/data/cache/klines';

function loadKlines(symbol) {
  const fs = require('fs');
  try {
    const data = JSON.parse(fs.readFileSync(`${DATA_DIR}/us_${symbol}.json`, 'utf-8'));
    return Array.isArray(data) ? data : (data.klines || []);
  } catch { return []; }
}

function calculateReturns(klines, days = 60) {
  const prices = klines.slice(-days).map(k => k.close);
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i-1]) / prices[i-1]);
  }
  return returns;
}

function correlation(r1, r2) {
  if (r1.length !== r2.length || r1.length < 10) return 0;
  const mean1 = r1.reduce((s, v) => s + v, 0) / r1.length;
  const mean2 = r2.reduce((s, v) => s + v, 0) / r2.length;
  let num = 0, den1 = 0, den2 = 0;
  for (let i = 0; i < r1.length; i++) {
    const d1 = r1[i] - mean1, d2 = r2[i] - mean2;
    num += d1 * d2;
    den1 += d1 * d1;
    den2 += d2 * d2;
  }
  return den1 && den2 ? num / Math.sqrt(den1 * den2) : 0;
}

async function getPositions() {
  const result = await pool.query(`
    SELECT symbol, quantity, pnl_pct FROM strategy_positions 
    WHERE status = 'open' AND quantity > 0
  `);
  return result.rows;
}

function checkRiskRules(positions, correlations) {
  const warnings = [];
  
  // 规则1: 单策略亏损>5%暂停
  for (const p of positions) {
    if (p.pnl_pct < -5) {
      warnings.push({ type: 'STRATEGY_STOP', symbol: p.symbol, pnl: p.pnl_pct, action: '暂停信号' });
    }
  }
  
  // 规则2: 相关性>0.8降级
  for (const [pair, corr] of Object.entries(correlations)) {
    if (corr > 0.8) {
      const [s1, s2] = pair.split('-');
      warnings.push({ type: 'CORRELATION_DOWNGRADE', pair, correlation: corr, action: '减少仓位建议' });
    }
  }
  
  // 规则3: 集中度>40%告警
  const totalQty = positions.reduce((s, p) => s + p.quantity, 0);
  for (const p of positions) {
    const concentration = (p.quantity / totalQty);
    if (concentration > 0.4) {
      warnings.push({ type: 'CONCENTRATION_ALERT', symbol: p.symbol, concentration: concentration * 100, action: '飞书告警' });
    }
  }
  
  return warnings;
}

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS portfolio_risk (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      metrics_json JSONB,
      warnings_json JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

async function sendFeishu(warnings) {
  if (warnings.length === 0) return;
  try {
    const emoji = { STRATEGY_STOP: '🛑', CORRELATION_DOWNGRADE: '⚠️', CONCENTRATION_ALERT: '🚨' };
    const lines = warnings.map(w => `${emoji[w.type]} ${w.type}: ${w.symbol || w.pair} - ${w.action || ''}`).join('\n');
    const message = `🚨 组合风控告警\n${lines}`;
    await sendFeishuText(message);
    console.log('✅ 飞书告警已发送');
  } catch (e) {
    console.log('⚠️ 飞书发送失败:', e.message);
  }
}

async function main() {
  console.log('=== Task C: 组合层风控 ===\n');
  
  await ensureTable();
  
  const positions = await getPositions();
  console.log(`持仓: ${positions.length}只\n`);
  
  if (positions.length < 2) {
    console.log('⚠️ 持仓不足2只，跳过相关性计算');
    await pool.end();
    return;
  }
  
  // 计算相关性
  const returnsMap = {};
  for (const p of positions) {
    const klines = loadKlines(p.symbol);
    returnsMap[p.symbol] = calculateReturns(klines);
  }
  
  const correlations = {};
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const s1 = positions[i].symbol, s2 = positions[j].symbol;
      const corr = correlation(returnsMap[s1], returnsMap[s2]);
      correlations[`${s1}-${s2}`] = corr;
    }
  }
  
  console.log('相关性矩阵:');
  for (const [pair, corr] of Object.entries(correlations)) {
    console.log(`  ${pair}: ${corr.toFixed(2)}`);
  }
  
  // 检查规则
  const warnings = checkRiskRules(positions, correlations);
  console.log(`\n告警: ${warnings.length}条`);
  for (const w of warnings) console.log(`  - ${w.type}: ${w.symbol || w.pair}`);
  
  // 写入
  await pool.query(`
    INSERT INTO portfolio_risk (metrics_json, warnings_json, created_at)
    VALUES ($1, $2, NOW())
  `, [JSON.stringify({ correlations, positions }), JSON.stringify(warnings)]);
  
  console.log('✅ 已写入portfolio_risk');
  
  // 飞书推送 - 任意告警类型都发送
  if (warnings.length > 0) {
    await sendFeishu(warnings);
  }
  
  await pool.end();
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });