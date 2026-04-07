#!/usr/bin/env node
/**
 * 因子库测试脚本
 * 用于验证因子计算的正确性
 */

const fs = require('fs');
const path = require('path');

// 测试数据：AAPL 最近100天
const testSymbol = 'AAPL';
const testDays = 100;

console.log('=== 因子库测试 ===\n');

// 1. 加载K线数据
console.log('1. 加载K线数据...');
const klinesPath = path.join(__dirname, '../data/cache/klines', `us_${testSymbol}.json`);
if (!fs.existsSync(klinesPath)) {
  console.error(`错误: 找不到 ${testSymbol} 的K线数据`);
  process.exit(1);
}

const klinesData = JSON.parse(fs.readFileSync(klinesPath, 'utf-8'));
const klines = (klinesData.klines || klinesData).slice(-testDays);
console.log(`  ✅ 加载 ${klines.length} 条K线数据`);

// 2. 加载财务数据
console.log('\n2. 加载财务数据...');
const fundamentalPath = path.join(__dirname, '../data/fundamental', `${testSymbol}_fundamental.json`);
if (fs.existsSync(fundamentalPath)) {
  const fundamental = JSON.parse(fs.readFileSync(fundamentalPath, 'utf-8'));
  console.log(`  ✅ PE: ${fundamental.pe}, ROE: ${fundamental.roe}`);
} else {
  console.log('  ⚠️  无财务数据');
}

// 3. 手动计算示例因子（验证逻辑）
console.log('\n3. 手动计算示例因子...');

// MOM_20: 20日动量
const closes = klines.map(k => parseFloat(k.close));
const mom20 = (closes[closes.length - 1] / closes[closes.length - 21] - 1) * 100;
console.log(`  MOM_20: ${mom20.toFixed(2)}%`);

// VOL_20: 20日波动率
const returns = [];
for (let i = 1; i < closes.length; i++) {
  returns.push((closes[i] / closes[i-1] - 1));
}
const recentReturns = returns.slice(-20);
const mean = recentReturns.reduce((a, b) => a + b, 0) / recentReturns.length;
const variance = recentReturns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / recentReturns.length;
const vol20 = Math.sqrt(variance) * Math.sqrt(252) * 100;
console.log(`  VOL_20: ${vol20.toFixed(2)}%`);

// RSI_14: 14日RSI
let gains = 0, losses = 0;
for (let i = closes.length - 14; i < closes.length; i++) {
  const change = closes[i] - closes[i-1];
  if (change > 0) gains += change;
  else losses -= change;
}
const avgGain = gains / 14;
const avgLoss = losses / 14;
const rs = avgGain / (avgLoss || 0.0001);
const rsi14 = 100 - (100 / (1 + rs));
console.log(`  RSI_14: ${rsi14.toFixed(2)}`);

console.log('\n✅ 测试完成');
console.log('\n下一步: 运行因子计算引擎，对比结果是否一致');
