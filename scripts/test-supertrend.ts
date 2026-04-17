/**
 * Supertrend 策略快速测试
 */

import * as fs from 'fs';

const DATA_DIR = '/Users/zhengzefeng/.openclaw/workspace/MarketPlayer/data/cache/klines';
const SYMBOLS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA'];

function loadKlines(symbol: string) {
  const data = JSON.parse(fs.readFileSync(`${DATA_DIR}/us_${symbol}.json`, 'utf-8'));
  return data.klines || [];
}

function calculateATR(klines: any[], period = 10): number[] {
  const atr: number[] = [];
  for (let i = 0; i < klines.length; i++) {
    if (i === 0) { atr.push(klines[i].high - klines[i].low); continue; }
    const tr = Math.max(klines[i].high - klines[i].low, Math.abs(klines[i].high - klines[i-1].close), Math.abs(klines[i].low - klines[i-1].close));
    atr.push(i < period ? (atr.reduce((s: number, v: number) => s+v, 0) + tr)/(i+1) : (atr[i-1]*(period-1)+tr)/period);
  }
  return atr;
}

function supertrendStrategy(klines: any[], atrPeriod = 10, multiplier = 2.0) {
  const signals = new Array(klines.length).fill(0);
  const atr = calculateATR(klines, atrPeriod);
  
  // 初始趋势基于前10个close
  const initAvg = klines.slice(0, 10).reduce((s: number, k: any) => s + k.close, 0) / 10;
  const firstClose = klines[10].close;
  let trend = firstClose > initAvg ? 'UP' : 'DOWN';
  
  for (let i = atrPeriod; i < klines.length; i++) {
    const atrVal = atr[i];
    if (!atrVal) continue;
    
    const close = klines[i].close;
    const high = klines[i].high;
    const low = klines[i].low;
    
    const upper = ((high + low) / 2) + multiplier * atrVal;
    const lower = ((high + low) / 2) - multiplier * atrVal;
    
    // 趋势突破检测 + 初始趋势反向检测
    if (close > upper) {
      if (trend === 'DOWN') { signals[i] = 1; } // 买入
      trend = 'UP';
    } else if (close < lower) {
      if (trend === 'UP') { signals[i] = -1; } // 卖出
      trend = 'DOWN';
    }
  }
  
  return signals;
}

function runBacktest(klines: any[], signals: number[]) {
  const tradeKlines = klines.slice(klines.length - signals.length);
  let position = 0, entry = 0, trades = 0, wins = 0, returns: number[] = [];
  
  for (let i = 0; i < signals.length; i++) {
    const price = tradeKlines[i].close;
    if (signals[i] === 1 && position === 0) { position = 1; entry = price; trades++; }
    else if (signals[i] === -1 && position === 1) { returns.push((price - entry) / entry); if (price > entry) wins++; position = 0; }
  }
  
  const totalReturn = returns.reduce((s, r) => s + r, 0);
  return { totalReturn: totalReturn * 100, trades, winRate: trades > 0 ? wins / trades * 100 : 0 };
}

// 测试
console.log('Supertrend 策略测试 (multiplier=2.0)\n');

for (const symbol of SYMBOLS) {
  const klines = loadKlines(symbol).slice(-500);
  if (klines.length < 100) continue;
  
  const result = runBacktest(klines, supertrendStrategy(klines, 10, 2.0));
  console.log(`${symbol}: ${result.totalReturn.toFixed(1)}% return, ${result.trades} trades, ${result.winRate.toFixed(0)}% win`);
}