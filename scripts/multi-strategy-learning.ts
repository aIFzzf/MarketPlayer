/**
 * 多策略学习闭环 - Multi-Strategy Learning Loop v1
 * 独立版本，不依赖外部类型
 */

import * as fs from 'fs';

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

// ==================== 策略评分 ====================
const SCORE_WEIGHTS = {
  return: 0.30,
  winRate: 0.20,
  sharpe: 0.25,
  drawdown: 0.25,
};

interface StrategyScore {
  strategyId: string;
  strategyName: string;
  totalReturn: number;
  annualReturn: number;
  maxDrawdown: number;
  winRate: number;
  sharpeRatio: number;
  totalTrades: number;
  score: number;
  recommendation: 'keep' | 'optimize' | 'remove';
}

function calculateScore(perf: Partial<StrategyScore>): number {
  const returnScore = Math.min(100, Math.max(0, (perf.totalReturn || 0) * 10));
  const winScore = (perf.winRate || 0) * 100;
  const sharpeScore = Math.min(100, Math.max(0, ((perf.sharpeRatio || 0) / 3 * 100)));
  const drawdownScore = Math.max(0, 100 - (perf.maxDrawdown || 0) * 2);
  
  return returnScore * SCORE_WEIGHTS.return +
    winScore * SCORE_WEIGHTS.winRate +
    sharpeScore * SCORE_WEIGHTS.sharpe +
    drawdownScore * SCORE_WEIGHTS.drawdown;
}

function getRecommendation(score: number, trades: number): 'keep' | 'optimize' | 'remove' {
  if (score >= 60 && trades >= 10) return 'keep';
  if (score >= 40) return 'optimize';
  return 'remove';
}

// ==================== 策略1: RSI 均值回归 ====================
function rsiStrategy(klines: KLine[]): number[] {
  const period = 14;
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
function maCrossStrategy(klines: KLine[]): number[] {
  const shortPeriod = 5, longPeriod = 20;
  const signals: number[] = new Array(klines.length).fill(0);
  
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

// ==================== 策略3: Bollinger Bands ====================
function bollingerStrategy(klines: KLine[]): number[] {
  const period = 20, stdDev = 2;
  const signals: number[] = new Array(klines.length).fill(0);
  
  for (let i = period; i < klines.length; i++) {
    const slice = klines.slice(i - period, i).map(k => k.close);
    const mean = slice.reduce((s, p) => s + p, 0) / slice.length;
    const variance = slice.reduce((s, p) => s + Math.pow(p - mean, 2), 0) / slice.length;
    const std = Math.sqrt(variance);
    
    const upper = mean + stdDev * std;
    const lower = mean - stdDev * std;
    const currentClose = klines[i].close;
    
    if (currentClose < lower) signals[i] = 1;
    else if (currentClose > upper) signals[i] = -1;
  }
  
  return signals;
}

// ==================== 策略4: Supertrend ====================
function calculateATR(klines: KLine[], period: number = 10): number[] {
  const atr: number[] = [];
  
  for (let i = 0; i < klines.length; i++) {
    if (i === 0) {
      // 第一个TR = H-L
      const tr = klines[i].high - klines[i].low;
      atr.push(tr);
      continue;
    }
    
    const high = klines[i].high;
    const low = klines[i].low;
    const prevClose = klines[i - 1].close;
    
    // True Range = max(H-L, |H-PC|, |L-PC|)
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    
    if (i < period) {
      // 简单平均
      const sumTR = atr.reduce((s, v) => s + v, 0) + tr;
      atr.push(sumTR / (i + 1));
    } else {
      // Wilder's smoothing
      const prevATR = atr[i - 1];
      atr.push((prevATR * (period - 1) + tr) / period);
    }
  }
  
  return atr;
}

function supertrendStrategy(klines: KLine[], atrPeriod: number = 10, multiplier: number = 0.5): number[] {
  const signals: number[] = new Array(klines.length).fill(0);
  const atr = calculateATR(klines, atrPeriod);
  
  // 初始化趋势 - 假设初始为 DOWN
  let trend: 'UP' | 'DOWN' = 'DOWN';
  
  // 从第一个有效ATR位置开始
  for (let i = atrPeriod; i < klines.length; i++) {
    const atrValue = atr[i];
    if (!atrValue || atrValue === 0) continue;
    
    const close = klines[i].close;
    const high = klines[i].high;
    const low = klines[i].low;
    
    // 上下轨道
    const midPrice = (high + low) / 2;
    const upperBand = midPrice + multiplier * atrValue;
    const lowerBand = midPrice - multiplier * atrValue;
    
    // 确定趋势：收盘价在上轨之上=UP，在下轨之下=DOWN，否则保持
    let newTrend: 'UP' | 'DOWN';
    if (close > upperBand) {
      newTrend = 'UP';
    } else if (close < lowerBand) {
      newTrend = 'DOWN';
    } else {
      newTrend = trend;
    }
    
    // 趋势转换检测
    if (trend === 'DOWN' && newTrend === 'UP') {
      signals[i] = 1;  // 买入信号
    } else if (trend === 'UP' && newTrend === 'DOWN') {
      signals[i] = -1; // 卖出信号
    }
    
    // 更新趋势
    trend = newTrend;
  }
  
  return signals;
}

// ==================== 回测 ====================
function runBacktest(klines: KLine[], strategyFn: (k: KLine[]) => number[]): StrategyScore {
  const signals = strategyFn(klines);
  const tradeKlines = klines.slice(klines.length - signals.length);
  
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
    
    const equity = 1 + returns.reduce((s, r) => s + r, 0);
    if (equity > peakEquity) peakEquity = equity;
    const dd = (peakEquity - equity) / peakEquity;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }
  
  const totalReturn = returns.length > 0 ? returns.reduce((s, r) => s + r, 0) : 0;
  const annualReturn = totalReturn / (signals.length / 252);
  const winRate = returns.length > 0 ? wins / returns.length : 0;
  
  const avgReturn = returns.length > 0 ? totalReturn / returns.length : 0;
  const stdReturn = returns.length > 1 
    ? Math.sqrt(returns.map(r => Math.pow(r - avgReturn, 2)).reduce((s, v) => s + v, 0) / returns.length)
    : 0;
  const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;
  
  const score = calculateScore({ totalReturn, annualReturn, maxDrawdown, winRate, sharpeRatio, totalTrades: trades });
  
  return {
    strategyId: '',
    strategyName: '',
    totalReturn,
    annualReturn,
    maxDrawdown,
    winRate,
    sharpeRatio,
    totalTrades: trades,
    score,
    recommendation: getRecommendation(score, trades),
  };
}

// ==================== 加载数据 ====================
function loadKlines(symbol: string): KLine[] {
  const filePath = `${DATA_DIR}/us_${symbol}.json`;
  if (!fs.existsSync(filePath)) {
    return [];
  }
  
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const klines = Array.isArray(data) ? data : data.klines || [];
  return klines;
}

// ==================== 主函数 ====================
async function runMultiStrategyLearning() {
  const STRATEGIES = [
    { id: 'rsi', name: 'RSI均值回归', fn: rsiStrategy },
    { id: 'ma_cross', name: '均线交叉', fn: maCrossStrategy },
    { id: 'bollinger', name: '布林带突破', fn: bollingerStrategy },
    { id: 'supertrend', name: 'Supertrend', fn: supertrendStrategy },
  ];
  
  const allResults: StrategyScore[] = [];
  
  console.log('🔄 多策略学习闭环 v1\n');
  
  for (const strategy of STRATEGIES) {
    console.log(`📊 回测策略: ${strategy.name}`);
    
    for (const symbol of SYMBOLS) {
      const klines = loadKlines(symbol);
      if (klines.length < 100) continue;
      
      const recentKlines = klines.slice(-500);
      const result = runBacktest(recentKlines, strategy.fn);
      
      result.strategyId = strategy.id;
      result.strategyName = strategy.name;
      
      allResults.push(result);
      console.log(`  ${symbol}: ${(result.totalReturn * 100).toFixed(1)}% return, ${result.totalTrades} trades`);
    }
  }
  
  // 聚合
  const strategyMap: Map<string, StrategyScore[]> = new Map();
  for (const perf of allResults) {
    const existing = strategyMap.get(perf.strategyId) || [];
    existing.push(perf);
    strategyMap.set(perf.strategyId, existing);
  }
  
  const finalScores: StrategyScore[] = [];
  for (const [strategyId, perfs] of strategyMap) {
    const avg: StrategyScore = {
      strategyId,
      strategyName: perfs[0].strategyName,
      totalReturn: perfs.reduce((s, p) => s + p.totalReturn, 0) / perfs.length,
      annualReturn: perfs.reduce((s, p) => s + p.annualReturn, 0) / perfs.length,
      maxDrawdown: perfs.reduce((s, p) => s + p.maxDrawdown, 0) / perfs.length,
      winRate: perfs.reduce((s, p) => s + p.winRate, 0) / perfs.length,
      sharpeRatio: perfs.reduce((s, p) => s + p.sharpeRatio, 0) / perfs.length,
      totalTrades: Math.round(perfs.reduce((s, p) => s + p.totalTrades, 0) / perfs.length),
      score: perfs.reduce((s, p) => s + p.score, 0) / perfs.length,
      recommendation: perfs[0].recommendation,
    };
    finalScores.push(avg);
  }
  
  // 排序
  finalScores.sort((a, b) => b.score - a.score);
  
  console.log('\n=== 策略评分结果 ===\n');
  let rank = 1;
  for (const s of finalScores) {
    console.log(`${rank++}. ${s.strategyName} (${s.strategyId}): ${s.score.toFixed(1)}分 [${s.recommendation}]`);
    console.log(`   Return: ${(s.totalReturn * 100).toFixed(1)}%, Win: ${(s.winRate * 100).toFixed(0)}%, Sharpe: ${s.sharpeRatio.toFixed(2)}, DD: ${(s.maxDrawdown * 100).toFixed(1)}%`);
  }
  
  const keep = finalScores.filter(s => s.recommendation === 'keep').map(s => s.strategyName);
  const optimize = finalScores.filter(s => s.recommendation === 'optimize').map(s => s.strategyName);
  const remove = finalScores.filter(s => s.recommendation === 'remove').map(s => s.strategyName);
  
  console.log('\n=== 决策 ===');
  console.log(`KEEP: ${keep.join(', ') || '无'}`);
  console.log(`OPTIMIZE: ${optimize.join(', ') || '无'}`);
  console.log(`REMOVE: ${remove.join(', ') || '无'}`);
  console.log(`\n🏆 最优策略: ${finalScores[0]?.strategyName || 'N/A'}`);
  
  return { finalScores, keep, optimize, remove };
}

// 运行
runMultiStrategyLearning()
  .then(() => process.exit(0))
  .catch(e => { console.error(e); process.exit(1); });