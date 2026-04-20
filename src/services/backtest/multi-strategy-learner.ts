/**
 * 多策略学习闭环 - Multi-Strategy Learning Loop
 * 
 * 接入3个策略：RSI / MA Cross / Bollinger Bands
 * 统一输出格式，接入学习闭环
 */

import * as fs from 'fs';
import { calculateStrategyScore, StrategyPerformance, StrategyScore } from './strategy-scorer';

const DATA_DIR = '/Users/zhengzefeng/.openclaw/workspace/MarketPlayer/data/cache/klines';
const SYMBOLS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA'];

interface KLine {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface BacktestResult {
  strategyId: string;
  strategyName: string;
  symbol: string;
  totalReturn: number;
  annualReturn: number;
  maxDrawdown: number;
  winRate: number;
  sharpeRatio: number;
  totalTrades: number;
}

// ==================== 策略1: RSI 均值回归 ====================
function rsiStrategy(klines: KLine[], period: number = 14): number[] {
  const signals: number[] = [];
  
  for (let i = period; i < klines.length; i++) {
    const prices = klines.slice(i - period, i + 1).map(k => k.close);
    let gains = 0, losses = 0;
    
    for (let j = 1; j < prices.length; j++) {
      const change = prices[j] - prices[j - 1];
      if (change > 0) gains += change;
      else losses -= change;
    }
    
    const rs = gains / (losses || 1);
    const rsi = 100 - (100 / (1 + rs));
    
    if (rsi < 30) signals.push(1);
    else if (rsi > 70) signals.push(-1);
    else signals.push(0);
  }
  
  return signals;
}

// ==================== 策略2: MA Cross ====================
function maCrossStrategy(klines: KLine[], shortPeriod: number = 5, longPeriod: number = 20): number[] {
  const signals: number[] = new Array(klines.length).fill(0);
  
  for (let i = longPeriod; i < klines.length; i++) {
    const shortMA = klines.slice(i - shortPeriod, i).reduce((s, k) => s + k.close, 0) / shortPeriod;
    const longMA = klines.slice(i - longPeriod, i).reduce((s, k) => s + k.close, 0) / longPeriod;
    const prevShortMA = klines.slice(i - shortPeriod - 1, i - 1).reduce((s, k) => s + k.close, 0) / shortPeriod;
    const prevLongMA = klines.slice(i - longPeriod - 1, i - 1).reduce((s, k) => s + k.close, 0) / longPeriod;
    
    // 金叉
    if (prevShortMA <= prevLongMA && shortMA > longMA) {
      signals[i] = 1;
    }
    // 死叉
    else if (prevShortMA >= prevLongMA && shortMA < longMA) {
      signals[i] = -1;
    }
  }
  
  return signals;
}

// ==================== 策略3: Bollinger Bands ====================
function bollingerStrategy(klines: KLine[], period: number = 20, stdDev: number = 2): number[] {
  const signals: number[] = new Array(klines.length).fill(0);
  
  for (let i = period; i < klines.length; i++) {
    const slice = klines.slice(i - period, i).map(k => k.close);
    const mean = slice.reduce((s, p) => s + p, 0) / slice.length;
    const variance = slice.reduce((s, p) => s + Math.pow(p - mean, 2), 0) / slice.length;
    const std = Math.sqrt(variance);
    
    const upper = mean + stdDev * std;
    const lower = mean - stdDev * std;
    const currentClose = klines[i].close;
    
    if (currentClose < lower) signals[i] = 1;  // 突破下轨买入
    else if (currentClose > upper) signals[i] = -1;  // 突破上轨卖出
  }
  
  return signals;
}

// ==================== 回测引擎 ====================
function runBacktest(
  klines: KLine[],
  strategyFn: (klines: KLine[]) => number[]
): BacktestResult & { trades: number } {
  const signals = strategyFn(klines);
  const startIndex = klines.length - signals.length;
  const tradeKlines = klines.slice(startIndex);
  
  let position = 0;
  let entryPrice = 0;
  let maxDrawdown = 0;
  let peakEquity = 1;
  let trades = 0;
  let wins = 0;
  const returns: number[] = [];
  
  for (let i = 0; i < signals.length; i++) {
    const price = tradeKlines[i].close;
    
    if (signals[i] === 1 && position === 0) {
      position = 1;
      entryPrice = price;
      trades++;
    } else if (signals[i] === -1 && position === 1) {
      const ret = (price - entryPrice) / entryPrice;
      returns.push(ret);
      if (ret > 0) wins++;
      position = 0;
    }
    
    // 计算权益
    const equity = 1 + returns.reduce((s, r) => s + r, 0);
    if (equity > peakEquity) peakEquity = equity;
    const dd = (peakEquity - equity) / peakEquity;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }
  
  const totalReturn = returns.length > 0 
    ? returns.reduce((s, r) => s + r, 0)
    : 0;
  const annualReturn = totalReturn / (signals.length / 252);
  const winRate = returns.length > 0 ? wins / returns.length : 0;
  
  // 计算 Sharpe (简化)
  const avgReturn = returns.length > 0 ? totalReturn / returns.length : 0;
  const stdReturn = returns.length > 1 
    ? Math.sqrt(returns.map(r => Math.pow(r - avgReturn, 2)).reduce((s, v) => s + v, 0) / returns.length)
    : 0;
  const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;
  
  return {
    strategyId: '',
    strategyName: '',
    symbol: '',
    totalReturn,
    annualReturn,
    maxDrawdown,
    winRate,
    sharpeRatio,
    totalTrades: trades,
    trades,
  };
}

// ==================== 加载数据 ====================
function loadKlines(symbol: string): KLine[] {
  const filePath = `${DATA_DIR}/us_${symbol}.json`;
  if (!fs.existsSync(filePath)) {
    return [];
  }
  
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return Array.isArray(data) ? data : data.klines || [];
}

// ==================== 主函数 ====================
export async function runMultiStrategyLearning(): Promise<{
  results: StrategyScore[];
  bestStrategy: string;
  recommendations: {
    keep: string[];
    optimize: string[];
    remove: string[];
  };
}> {
  const STRATEGIES = [
    { id: 'rsi', name: 'RSI均值回归', fn: rsiStrategy },
    { id: 'ma_cross', name: '均线交叉', fn: maCrossStrategy },
    { id: 'bollinger', name: '布林带突破', fn: bollingerStrategy },
  ];
  
  const allResults: StrategyPerformance[] = [];
  
  console.log('🔄 多策略学习闭环 v1\n');
  
  for (const strategy of STRATEGIES) {
    console.log(`📊 回测策略: ${strategy.name}`);
    
    for (const symbol of SYMBOLS) {
      const klines = loadKlines(symbol);
      if (klines.length < 100) continue;
      
      // 取最近2年数据
      const recentKlines = klines.slice(-500);
      const result = runBacktest(recentKlines, strategy.fn);
      
      const perf: StrategyPerformance = {
        strategyId: strategy.id,
        strategyName: strategy.name,
        symbol,
        period: 500,
        totalReturn: result.totalReturn,
        annualReturn: result.annualReturn,
        maxDrawdown: result.maxDrawdown,
        winRate: result.winRate,
        sharpeRatio: result.sharpeRatio,
        totalTrades: result.totalTrades,
        lastUpdated: new Date(),
      };
      
      const score = calculateStrategyScore(perf);
      score.strategyId = strategy.id;
      score.strategyName = strategy.name;
      
      allResults.push({
        ...perf,
        score: score.score,
        rank: 0,
        breakdown: score.breakdown,
        recommendation: score.recommendation,
      });
      
      console.log(`  ${symbol}: ${(result.totalReturn * 100).toFixed(1)}% return, ${result.totalTrades} trades, ${(result.winRate * 100).toFixed(0)}% win`);
    }
  }
  
  // 按策略聚合（取平均）
  const strategyAvg: Map<string, StrategyPerformance[]> = new Map();
  for (const perf of allResults) {
    const existing = strategyAvg.get(perf.strategyId) || [];
    existing.push(perf);
    strategyAvg.set(perf.strategyId, existing);
  }
  
  const finalScores: StrategyScore[] = [];
  let rank = 1;
  
  for (const [strategyId, perfs] of strategyAvg) {
    const avgPerf: StrategyPerformance = {
      strategyId,
      strategyName: perfs[0].strategyName,
      symbol: 'ALL',
      period: 500,
      totalReturn: perfs.reduce((s, p) => s + p.totalReturn, 0) / perfs.length,
      annualReturn: perfs.reduce((s, p) => s + p.annualReturn, 0) / perfs.length,
      maxDrawdown: perfs.reduce((s, p) => s + p.maxDrawdown, 0) / perfs.length,
      winRate: perfs.reduce((s, p) => s + p.winRate, 0) / perfs.length,
      sharpeRatio: perfs.reduce((s, p) => s + p.sharpeRatio, 0) / perfs.length,
      totalTrades: Math.round(perfs.reduce((s, p) => s + p.totalTrades, 0) / perfs.length),
      lastUpdated: new Date(),
    };
    
    const score = calculateStrategyScore(avgPerf);
    score.rank = rank++;
    finalScores.push(score);
  }
  
  // 排序
  finalScores.sort((a, b) => b.score - a.score);
  
  console.log('\n=== 策略评分结果 ===\n');
  for (const s of finalScores) {
    console.log(`${s.rank}. ${s.strategyId}: ${s.score.toFixed(1)}分 [${s.recommendation}]`);
    console.log(`   Return: ${(s.breakdown.returnScore).toFixed(0)}, Win: ${(s.breakdown.winScore).toFixed(0)}, Sharpe: ${(s.breakdown.sharpeScore).toFixed(0)}, DD: ${(s.breakdown.drawdownScore).toFixed(0)}`);
  }
  
  const keep = finalScores.filter(s => s.recommendation === 'keep').map(s => s.strategyId);
  const optimize = finalScores.filter(s => s.recommendation === 'optimize').map(s => s.strategyId);
  const remove = finalScores.filter(s => s.recommendation === 'remove').map(s => s.strategyId);
  
  console.log('\n=== 决策 ===');
  console.log(`KEEP: ${keep.join(', ') || '无'}`);
  console.log(`OPTIMIZE: ${optimize.join(', ') || '无'}`);
  console.log(`REMOVE: ${remove.join(', ') || '无'}`);
  
  const bestStrategy = finalScores[0]?.strategyId || 'N/A';
  
  return {
    results: finalScores,
    bestStrategy,
    recommendations: { keep, optimize, remove },
  };
}

// 单独运行
if (require.main === module) {
  runMultiStrategyLearning()
    .then(r => {
      console.log(`\n🏆 最优策略: ${r.bestStrategy}`);
      process.exit(0);
    })
    .catch(e => {
      console.error(e);
      process.exit(1);
    });
}

export default { runMultiStrategyLearning };