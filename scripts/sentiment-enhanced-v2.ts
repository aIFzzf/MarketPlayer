/**
 * 情绪增强多策略学习闭环 v2 - 修复版
 * 
 * 对比两组策略：
 * 1. 纯技术策略
 * 2. 情绪增强策略
 */

import * as fs from 'fs';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: 'postgresql://trading_user:password@localhost:5432/trading_bot' });

const DATA_DIR = '/Users/zhengzefeng/.openclaw/workspace/MarketPlayer/data/cache/klines';
const SYMBOLS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA'];

interface KLine { date: string; open: number; high: number; low: number; close: number; volume: number; }
interface StrategyScore { strategyId: string; strategyName: string; totalReturn: number; annualReturn: number; maxDrawdown: number; winRate: number; sharpeRatio: number; totalTrades: number; score: number; recommendation: 'keep' | 'optimize' | 'remove'; }

const SCORE_WEIGHTS = { return: 0.30, winRate: 0.20, sharpe: 0.25, drawdown: 0.25 };

function calculateScore(perf: Partial<StrategyScore>): number {
  const returnScore = Math.min(100, Math.max(0, (perf.totalReturn || 0) * 10));
  const winScore = (perf.winRate || 0) * 100;
  const sharpeScore = Math.min(100, Math.max(0, ((perf.sharpeRatio || 0) / 3 * 100)));
  const drawdownScore = Math.max(0, 100 - (perf.maxDrawdown || 0) * 2);
  return returnScore * SCORE_WEIGHTS.return + winScore * SCORE_WEIGHTS.winRate + sharpeScore * SCORE_WEIGHTS.sharpe + drawdownScore * SCORE_WEIGHTS.drawdown;
}

function getRecommendation(score: number, trades: number): 'keep' | 'optimize' | 'remove' {
  if (score >= 60 && trades >= 10) return 'keep';
  if (score >= 40) return 'optimize';
  return 'remove';
}

// 情绪缓存: symbol -> score (-1 到 1)
const sentimentCache: Map<string, number> = new Map();

async function loadSentimentData() {
  // 直接使用原始分数 50/-50/0 映射
  const result = await pool.query(`
    SELECT symbol, score, COUNT(*) as cnt
    FROM sentiment_history
    WHERE created_at > NOW() - INTERVAL '30 days'
    GROUP BY symbol, score
    ORDER BY symbol, cnt DESC
  `);
  
  // 取最常见的情绪分数
  const symbolBest: Map<string, number> = new Map();
  for (const row of result.rows) {
    const cnt = parseInt(row.cnt);
    if (!symbolBest.has(row.symbol) || cnt > (symbolBest.get(row.symbol + '_cnt') || 0)) {
      symbolBest.set(row.symbol, parseFloat(row.score) / 50); // 归一化到 -1 到 1
      symbolBest.set(row.symbol + '_cnt', cnt);
    }
  }
  
  for (const [symbol, score] of symbolBest) {
    if (!symbol.includes('_cnt')) {
      sentimentCache.set(symbol, score);
    }
  }
  console.log(`📊 已加载 ${sentimentCache.size} 只股票的情绪数据`);
}

// ==================== 基础策略 ====================
function rsiStrategy(klines: KLine[]): number[] {
  const period = 14, signals: number[] = [];
  for (let i = period; i < klines.length; i++) {
    const prices = klines.slice(i - period, i + 1).map(k => k.close);
    let gains = 0, losses = 0;
    for (let j = 1; j < prices.length; j++) {
      const change = prices[j] - prices[j - 1];
      if (change > 0) gains += change; else losses -= change;
    }
    const rsi = 100 - (100 / (1 + gains / (losses || 1)));
    signals.push(rsi < 35 ? 1 : rsi > 65 ? -1 : 0);
  }
  return signals;
}

function maCrossStrategy(klines: KLine[]): number[] {
  const shortPeriod = 5, longPeriod = 20, signals: number[] = new Array(klines.length).fill(0);
  for (let i = longPeriod; i < klines.length; i++) {
    const shortMA = klines.slice(i - shortPeriod, i).reduce((s, k) => s + k.close, 0) / shortPeriod;
    const longMA = klines.slice(i - longPeriod, i).reduce((s, k) => s + k.close, 0) / longPeriod;
    const prevShortMA = klines.slice(i - shortPeriod - 1, i - 1).reduce((s, k) => s + k.close, 0) / shortPeriod;
    const prevLongMA = klines.slice(i - longPeriod - 1, i - 1).reduce((s, k) => s + k.close, 0) / longPeriod;
    if (prevShortMA <= prevLongMA && shortMA > longMA) signals[i] = 1;
    else if (prevShortMA >= prevLongMA && shortMA < longMA) signals[i] = -1;
  }
  return signals;
}

function bollingerStrategy(klines: KLine[]): number[] {
  const period = 20, stdDev = 2, signals: number[] = new Array(klines.length).fill(0);
  for (let i = period; i < klines.length; i++) {
    const slice = klines.slice(i - period, i).map(k => k.close);
    const mean = slice.reduce((s, p) => s + p, 0) / slice.length;
    const variance = slice.reduce((s, p) => s + Math.pow(p - mean, 2), 0) / slice.length;
    const upper = mean + stdDev * Math.sqrt(variance);
    const lower = mean - stdDev * Math.sqrt(variance);
    if (klines[i].close < lower) signals[i] = 1;
    else if (klines[i].close > upper) signals[i] = -1;
  }
  return signals;
}

// ==================== 情绪增强策略 ====================
function sentimentEnhancedStrategy(
  klines: KLine[], 
  baseStrategy: (k: KLine[]) => number[], 
  symbol: string, 
  enhance: boolean
): number[] {
  if (!enhance) return baseStrategy(klines);
  
  const baseSignals = baseStrategy(klines);
  const sentiment = sentimentCache.get(symbol) || 0; // -1 到 1
  
  console.log(`  应用情绪: ${symbol}=${sentiment > 0 ? '+' : ''}${(sentiment * 100).toFixed(0)}%`);
  
  return baseSignals.map((signal, i) => {
    if (signal === 1) { // 买入信号
      if (sentiment >= 0.5) return 1;      // 强正面，增强
      else if (sentiment >= 0) return 1;  // 正面保持
      else return 0;                     // 负面过滤掉
    } else if (signal === -1) { // 卖出信号
      if (sentiment <= -0.5) return -1; // 强负面，加速
      else if (sentiment <= 0) return -1; // 负面保持
      else return 0;                     // 正面延迟
    }
    return 0;
  });
}

// ==================== 回测 ====================
function runBacktest(klines: KLine[], signals: number[]): StrategyScore {
  const tradeKlines = klines.slice(klines.length - signals.length);
  let position = 0, entryPrice = 0, maxDrawdown = 0, peakEquity = 1, trades = 0, wins = 0;
  const returns: number[] = [];
  
  for (let i = 0; i < signals.length; i++) {
    const price = tradeKlines[i].close;
    if (signals[i] === 1 && position === 0) { position = 1; entryPrice = price; trades++; }
    else if (signals[i] === -1 && position === 1) {
      const ret = (price - entryPrice) / entryPrice;
      returns.push(ret);
      if (ret > 0) wins++;
      position = 0;
    }
    const equity = 1 + returns.reduce((s, r) => s + r, 0);
    if (equity > peakEquity) peakEquity = equity;
    const dd = (peakEquity - equity) / peakEquity;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }
  
  const totalReturn = returns.length > 0 ? returns.reduce((s, r) => s + r, 0) : 0;
  const annualReturn = totalReturn / (signals.length / 252);
  const winRate = returns.length > 0 ? wins / returns.length : 0;
  const avgReturn = returns.length > 0 ? totalReturn / returns.length : 0;
  const stdReturn = returns.length > 1 ? Math.sqrt(returns.map(r => Math.pow(r - avgReturn, 2)).reduce((s, v) => s + v, 0) / returns.length) : 0;
  const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;
  const score = calculateScore({ totalReturn, annualReturn, maxDrawdown, winRate, sharpeRatio, totalTrades: trades });
  
  return { strategyId: '', strategyName: '', totalReturn, annualReturn, maxDrawdown, winRate, sharpeRatio, totalTrades: trades, score, recommendation: getRecommendation(score, trades) };
}

function loadKlines(symbol: string): KLine[] {
  const filePath = `${DATA_DIR}/us_${symbol}.json`;
  if (!fs.existsSync(filePath)) return [];
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return Array.isArray(data) ? data : data.klines || [];
}

// ==================== 主函数 ====================
async function main() {
  await loadSentimentData();
  
  const STRATEGIES = [
    { id: 'rsi', name: 'RSI', fn: rsiStrategy },
    { id: 'ma_cross', name: '均线交叉', fn: maCrossStrategy },
    { id: 'bollinger', name: '布林带', fn: bollingerStrategy },
  ];
  
  const results: { base: StrategyScore; enhanced: StrategyScore; symbol: string; strategy: string }[] = [];
  
  console.log('\n🔄 情绪增强策略对比测试 v2\n');
  
  for (const strategy of STRATEGIES) {
    console.log(`📊 策略: ${strategy.name}`);
    
    for (const symbol of SYMBOLS) {
      const klines = loadKlines(symbol);
      if (klines.length < 100) continue;
      
      const recentKlines = klines.slice(-500);
      
      // 纯技术
      const baseSignals = strategy.fn(recentKlines);
      const baseResult = runBacktest(recentKlines, baseSignals);
      baseResult.strategyId = strategy.id;
      baseResult.strategyName = strategy.name;
      
      // 情绪增强
      const enhancedSignals = sentimentEnhancedStrategy(recentKlines, strategy.fn, symbol, true);
      const enhancedResult = runBacktest(recentKlines, enhancedSignals);
      enhancedResult.strategyId = `${strategy.id}_sentiment`;
      enhancedResult.strategyName = `${strategy.name}+情绪`;
      
      results.push({ base: baseResult, enhanced: enhancedResult, symbol, strategy: strategy.name });
      
      const diff = (enhancedResult.totalReturn - baseResult.totalReturn) * 100;
      console.log(`  ${symbol}: 技术 ${(baseResult.totalReturn * 100).toFixed(1)}% (${baseResult.totalTrades}笔) → 情绪 ${(enhancedResult.totalReturn * 100).toFixed(1)}% (${enhancedResult.totalTrades}笔) [${diff > 0 ? '+' : ''}${diff.toFixed(1)}%]`);
    }
  }
  
  // 聚合结果
  console.log('\n=== 聚合对比结果 ===\n');
  
  const summary: { name: string; base: number; enhanced: number; changed: number }[] = [];
  
  for (const strategy of STRATEGIES) {
    const strategyResults = results.filter(r => r.strategy === strategy.name);
    if (strategyResults.length === 0) continue;
    
    const baseAvg = strategyResults.reduce((s, r) => s + r.base.totalReturn, 0) / strategyResults.length;
    const enhancedAvg = strategyResults.reduce((s, r) => s + r.enhanced.totalReturn, 0) / strategyResults.length;
    
    summary.push({
      name: strategy.name,
      base: baseAvg * 100,
      enhanced: enhancedAvg * 100,
      changed: (enhancedAvg - baseAvg) * 100
    });
  }
  
  for (const s of summary) {
    console.log(`${s.name}:`);
    console.log(`  技术: ${s.base.toFixed(1)}%`);
    console.log(`  情绪增强: ${s.enhanced.toFixed(1)}%`);
    console.log(`  变化: ${s.changed > 0 ? '+' : ''}${s.changed.toFixed(1)}%`);
  }
  
  // 结论
  const best = summary.reduce((best, s) => s.enhanced > best.enhanced ? s : best, summary[0]);
  console.log(`\n🏆 情绪增强最优策略: ${best.name} (${best.enhanced.toFixed(1)}%)`);
  
  await pool.end();
  return summary;
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });