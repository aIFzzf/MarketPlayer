/**
 * 简化学习闭环 - RSI/布林带策略回测
 * 验证 Sharpe > 1.5 阈值
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://trading_user:password@localhost:5432/trading_bot' });
const DATA_DIR = '/Users/zhengzefeng/.openclaw/workspace/MarketPlayer/data/cache/klines';

// 加载K线数据
function loadKlines(symbol) {
  const file = path.join(DATA_DIR, `us_${symbol}.json`);
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return data.map(k => ({
      date: k.date || k.time,
      open: parseFloat(k.open),
      high: parseFloat(k.high),
      low: parseFloat(k.low),
      close: parseFloat(k.close),
      volume: parseInt(k.volume)
    }));
  } catch {
    return [];
  }
}

// RSI 策略
function rsiSignal(klines, period = 14, oversold = 30, overbought = 70) {
  if (klines.length < period + 1) return 0;
  const prices = klines.map(k => k.close);
  const rsi = calculateRSI(prices, period);
  if (rsi < oversold) return 1;  // 买入
  if (rsi > overbought) return -1;  // 卖出
  return 0;
}

function calculateRSI(prices, period) {
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// 布林带策略
function bollingerSignal(klines, period = 20, stdDev = 2) {
  if (klines.length < period + 1) return 0;
  const prices = klines.map(k => k.close).slice(-period);
  const sma = prices.reduce((a, b) => a + b, 0) / period;
  const variance = prices.reduce((s, p) => s + Math.pow(p - sma, 2), 0) / period;
  const std = Math.sqrt(variance);
  const upper = sma + stdDev * std;
  const lower = sma - stdDev * std;
  const currentPrice = prices[prices.length - 1];
  
  if (currentPrice < lower) return 1;
  if (currentPrice > upper) return -1;
  return 0;
}

// 回测引擎
function backtest(klines, strategyFn) {
  let cash = 10000;
  let position = 0;
  const trades = [];
  const equity = [cash];
  
  for (let i = 50; i < klines.length - 1; i++) {
    const signal = strategyFn(klines.slice(0, i + 1));
    const price = klines[i].close;
    const nextPrice = klines[i + 1].close;
    
    if (signal === 1 && position === 0) {
      position = cash / price;
      cash = 0;
      trades.push({ type: 'buy', price, date: klines[i].date });
    } else if (signal === -1 && position > 0) {
      cash = position * nextPrice;
      trades.push({ type: 'sell', price: nextPrice, date: klines[i + 1].date, pnl: (nextPrice - price) / price });
      position = 0;
    }
    
    const currentValue = position > 0 ? position * price : cash;
    equity.push(currentValue);
  }
  
  // 计算指标
  const returns = [];
  for (let i = 1; i < equity.length; i++) {
    returns.push((equity[i] - equity[i - 1]) / equity[i - 1]);
  }
  
  const totalReturn = (equity[equity.length - 1] - 10000) / 10000;
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const stdReturn = Math.sqrt(returns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / returns.length);
  const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;
  
  // 最大回撤
  let maxDrawdown = 0;
  let peak = equity[0];
  for (const e of equity) {
    if (e > peak) peak = e;
    const dd = (peak - e) / peak;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }
  
  const winningTrades = trades.filter(t => t.pnl > 0).length;
  const winRate = trades.length > 0 ? winningTrades / trades.length : 0;
  
  return {
    totalReturn,
    sharpeRatio,
    maxDrawdown,
    winRate,
    totalTrades: trades.length
  };
}

// 主流程
async function run() {
  console.log('🔄 简化学习闭环 - RSI/布林带策略\n');
  
  // 加载股票列表
  let symbols = [];
  try {
    const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('us_') && f.endsWith('.json'));
    symbols = files.map(f => f.replace('us_', '').replace('.json', ''));
  } catch {
    symbols = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'NFLX'];
  }
  console.log(`📊 股票数: ${symbols.length}只\n`);
  
  const STRATEGIES = [
    { id: 'rsi', name: 'RSI均值回归', fn: rsiSignal },
    { id: 'bollinger', name: '布林带突破', fn: bollingerSignal }
  ];
  
  const results = [];
  
  for (const strat of STRATEGIES) {
    console.log(`📈 策略: ${strat.name}`);
    let totalReturn = 0, totalSharpe = 0, totalWinRate = 0, totalTrades = 0, count = 0;
    
    for (const symbol of symbols) {
      const klines = loadKlines(symbol);
      if (klines.length < 100) continue;
      
      const recentKlines = klines.slice(-500);
      const perf = backtest(recentKlines, strat.fn);
      
      totalReturn += perf.totalReturn;
      totalSharpe += perf.sharpeRatio;
      totalWinRate += perf.winRate;
      totalTrades += perf.totalTrades;
      count++;
      
      if (perf.totalTrades > 0) {
        console.log(`  ${symbol}: Return=${(perf.totalReturn*100).toFixed(1)}%, Sharpe=${perf.sharpeRatio.toFixed(2)}, Win=${(perf.winRate*100).toFixed(0)}%`);
      }
    }
    
    const avg = {
      strategyId: strat.id,
      strategyName: strat.name,
      totalReturn: count > 0 ? totalReturn / count : 0,
      sharpeRatio: count > 0 ? totalSharpe / count : 0,
      winRate: count > 0 ? totalWinRate / count : 0,
      totalTrades: count > 0 ? Math.round(totalTrades / count) : 0
    };
    results.push(avg);
    console.log(`  平均: Return=${(avg.totalReturn*100).toFixed(1)}%, Sharpe=${avg.sharpeRatio.toFixed(2)}, Win=${(avg.winRate*100).toFixed(0)}%\n`);
  }
  
  // 决策
  console.log('=== 决策 ===');
  const threshold = 1.5;
  
  for (const r of results) {
    const upgraded = r.sharpeRatio > threshold;
    console.log(`${r.strategyName}: Sharpe=${r.sharpeRatio.toFixed(2)} ${upgraded ? '✅ 升级' : '❌ 不升级'}`);
    
    if (upgraded) {
      // 写入learning_actions
      try {
        await pool.query(
          `INSERT INTO learning_actions (id, hypothesis, confidence, reasoning, new_params, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [
            `${r.strategyId}-${Date.now()}`,
            `Sharpe > ${threshold} 策略升级`,
            r.sharpeRatio / 3,
            JSON.stringify({ sharpe: r.sharpeRatio, return: r.totalReturn, winRate: r.winRate }),
            JSON.stringify({ id: r.strategyId, name: r.strategyName, sharpe: r.sharpeRatio, action: 'upgrade' })
          ]
        );
        console.log(`  ✅ 已写入 learning_actions`);
      } catch (e) {
        console.log(`  ⚠️ 写入失败: ${e.message}`);
      }
    }
  }
  
  await pool.end();
  console.log('\n🏁 完成');
}

run().catch(e => { console.error(e); process.exit(1); });