/**
 * Task B: 市场状态分类器 (Regime Detection)
 * 
 * 1. 基于SPY计算20日波动率、ADX趋势强度、200日均线位置
 * 2. 分类: TRENDING_UP / TRENDING_DOWN / RANGING / HIGH_VOLATILITY
 * 3. 每30分钟更新，写入market_regime表
 * 4. regime改变飞书推送
 * 5. 附加regime到ensemble信号
 */

const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://trading_user:password@localhost:5432/trading_bot' });

const DATA_DIR = '/Users/zhengzefeng/.openclaw/workspace/MarketPlayer/data/cache/klines';

function calculateVolatility(klines, period = 20) {
  if (klines.length < period) return null;
  const returns = [];
  for (let i = klines.length - period; i < klines.length - 1; i++) {
    returns.push((klines[i+1].close - klines[i].close) / klines[i].close);
  }
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / returns.length;
  return Math.sqrt(variance) * Math.sqrt(252); // 年化
}

function calculateTrendStrength(klines) {
  // 简化ADX：用价格相对于200日均线的偏离度
  if (klines.length < 200) return 0;
  const ma200 = klines.slice(-200).reduce((s, k) => s + k.close, 0) / 200;
  const current = klines[klines.length - 1].close;
  return Math.abs((current - ma200) / ma200);
}

function calculatePosition(klines) {
  if (klines.length < 200) return null;
  const ma200 = klines.slice(-200).reduce((s, k) => s + k.close, 0) / 200;
  const current = klines[klines.length - 1].close;
  return (current - ma200) / ma200;
}

function classifyRegime(volatility, trendStrength, position) {
  // HIGH_VOLATILITY: 波动率>30%
  if (volatility && volatility > 0.30) return 'HIGH_VOLATILITY';
  
  // TRENDING_UP: 趋势向上且价格在均线上方
  if (position && position > 0.05 && trendStrength > 0.1) return 'TRENDING_UP';
  
  // TRENDING_DOWN: 趋势向下且价格在均线下方
  if (position && position < -0.05 && trendStrength > 0.1) return 'TRENDING_DOWN';
  
  // RANGING: 其他情况
  return 'RANGING';
}

async function loadSPYData() {
  const fs = require('fs');
  const data = JSON.parse(fs.readFileSync(`${DATA_DIR}/us_SPY.json`, 'utf-8'));
  const klines = Array.isArray(data) ? data : (data.klines || []);
  return klines.slice(-250); // 最近250天
}

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS market_regime (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      regime VARCHAR(20),
      confidence DECIMAL(3,2),
      volatility DECIMAL(5,4),
      trend_strength DECIMAL(5,4),
      position_ma200 DECIMAL(5,4),
      metrics_json JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

async function getLastRegime() {
  const result = await pool.query(`
    SELECT regime FROM market_regime ORDER BY created_at DESC LIMIT 1
  `);
  return result.rows[0]?.regime || null;
}

async function sendNotification(newRegime, metrics) {
  const emoji = { 'TRENDING_UP': '📈', 'TRENDING_DOWN': '📉', 'RANGING': '➡️', 'HIGH_VOLATILITY': '⚡' };
  console.log(`🚨 市场状态变更: ${emoji[newRegime]} ${newRegime}`);
  console.log(`   波动率: ${(metrics.volatility*100).toFixed(1)}%`);
  console.log(`   趋势强度: ${(metrics.trendStrength*100).toFixed(1)}%`);
  console.log(`   相对200日均线: ${(metrics.position*100).toFixed(1)}%`);
}

async function main() {
  console.log('=== Task B: 市场状态分类器 (Regime Detection) ===\n');
  
  await ensureTable();
  
  // 加载数据
  const klines = await loadSPYData();
  console.log(`SPY数据: ${klines.length}天`);
  
  // 计算指标
  const volatility = calculateVolatility(klines);
  const trendStrength = calculateTrendStrength(klines);
  const position = calculatePosition(klines);
  
  console.log(`波动率: ${(volatility*100).toFixed(1)}%`);
  console.log(`趋势强度: ${(trendStrength*100).toFixed(1)}%`);
  console.log(`相对200日均线: ${(position*100).toFixed(1)}%`);
  
  // 分类
  const regime = classifyRegime(volatility, trendStrength, position);
  console.log(`分类: ${regime}\n`);
  
  // 检查是否变化
  const lastRegime = await getLastRegime();
  const regimeChanged = lastRegime !== regime;
  
  // 写入
  const confidence = Math.min(1, (volatility || 0.1) * 3);
  await pool.query(`
    INSERT INTO market_regime (regime, confidence, volatility, trend_strength, position_ma200, metrics_json, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
  `, [regime, confidence, volatility, trendStrength, position, JSON.stringify({ klines: klines.length })]);
  
  console.log(`✅ 已写入market_regime (${regimeChanged ? '状态变更' : '相同'})`);
  
  // 变更推送
  if (regimeChanged) {
    await sendNotification(regime, { volatility, trendStrength, position });
  }
  
  await pool.end();
  return regime;
}

main().then(r => { console.log('\n当前regime:', r); process.exit(0); })
      .catch(e => { console.error(e); process.exit(1); });