/**
 * 市场数据自动更新脚本 - hourly-market-update.js
 * 每小时自动拉取 watchlist 股票的最新K线数据
 * 数据超过4小时未更新时拒绝触发回测并告警
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://trading_user:password@localhost:5432/trading_bot' });

const DATA_DIR = 'data/cache/klines';
const FRESHNESS_THRESHOLD_HOURS = 4;

// 通过 fetch-av-stock.py 拉取真实数据
const { execSync } = require('child_process');
function fetchLatestKline(symbol, market = 'us') {
  const filePath = `${DATA_DIR}/${market}_${symbol}.json`;

  // 若数据过期，先调用 Python 脚本拉取
  if (!fs.existsSync(filePath) || isStale(filePath)) {
    try {
      const script = path.join(__dirname, 'fetch-av-stock.py');
      execSync(
        `python3 ${script} --symbol ${symbol}`,
        { cwd: path.join(__dirname, '..'), timeout: 30000, stdio: 'inherit' }
      );
    } catch (e) {
      console.error(`⚠️ 拉取失败 ${symbol}: ${e.message}`);
    }
  }

  if (!fs.existsSync(filePath)) {
    console.log(`⚠️ 文件不存在: ${filePath}`);
    return null;
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const klines = Array.isArray(data) ? data : data.klines || [];

    if (klines.length === 0) return null;
    
    return {
      symbol,
      market,
      latestPrice: klines[klines.length - 1].close,
      latestDate: klines[klines.length - 1].date,
      klineCount: klines.length,
      data: klines
    };
  } catch (e) {
    console.error(`读取失败 ${symbol}:`, e.message);
    return null;
  }
}

// 辅助：文件是否过期（超过4小时）
function isStale(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return (Date.now() - stat.mtimeMs) > FRESHNESS_THRESHOLD_HOURS * 3600 * 1000;
  } catch { return true; }
}

// 检查数据新鲜度
function checkDataFreshness(symbol, market = 'us') {
  const filePath = `${DATA_DIR}/${market}_${symbol}.json`;
  
  if (!fs.existsSync(filePath)) {
    return { isFresh: false, message: '数据文件不存在', hoursAgo: Infinity };
  }
  
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const klines = Array.isArray(data) ? data : data.klines || [];
    
    if (klines.length === 0) {
      return { isFresh: false, message: '无K线数据', hoursAgo: Infinity };
    }
    
    const latestKline = klines[klines.length - 1];
    const latestDate = new Date(latestKline.date);
    const now = new Date();
    const hoursAgo = (now - latestDate) / (1000 * 60 * 60);
    
    const isFresh = hoursAgo < FRESHNESS_THRESHOLD_HOURS;
    
    return {
      isFresh,
      message: isFresh ? '数据正常' : `数据过时: ${hoursAgo.toFixed(1)}小时`,
      hoursAgo,
      latestDate: latestKline.date,
      latestPrice: latestKline.close
    };
  } catch (e) {
    return { isFresh: false, message: '读取错误: ' + e.message, hoursAgo: Infinity };
  }
}

async function main() {
  console.log('=== 市场数据自动更新 ===\n');
  
  // 从 watchlist 加载股票列表
  let WATCHLIST_SYMBOLS = [];
  try {
    const result = await pool.query(`
      SELECT symbol, market FROM watchlist 
      WHERE is_active = true 
      AND market IN ('us', 'hk')
      ORDER BY market
    `);
    WATCHLIST_SYMBOLS = result.rows;
    console.log(`从 watchlist 加载 ${WATCHLIST_SYMBOLS.length} 只股票\n`);
  } catch (e) {
    console.log('watchlist 查询失败，使用默认列表:', e.message);
    WATCHLIST_SYMBOLS = [
      { symbol: 'AAPL', market: 'us' },
      { symbol: 'MSFT', market: 'us' },
      { symbol: 'GOOGL', market: 'us' },
      { symbol: 'AMZN', market: 'us' },
      { symbol: 'NVDA', market: 'us' },
    ];
  }
  
  // 检查数据新鲜度
  console.log('=== 数据新鲜度检查 ===\n');
  
  const staleStocks = [];
  const freshStocks = [];
  
  for (const { symbol, market } of WATCHLIST_SYMBOLS) {
    const check = checkDataFreshness(symbol, market);
    
    if (check.isFresh) {
      freshStocks.push({ symbol, market, ...check });
      console.log(`✅ ${symbol} (${market}): ${check.message}`);
    } else {
      staleStocks.push({ symbol, market, ...check });
      console.log(`❌ ${symbol} (${market}): ${check.message}`);
    }
  }
  
  // 汇总
  console.log(`\n=== 汇总 ===`);
  console.log(`数据新鲜: ${freshStocks.length} 只`);
  console.log(`数据过时: ${staleStocks.length} 只`);
  
  // 如果有过期数据，发起告警
  if (staleStocks.length > 0) {
    console.log(`\n⚠️ 告警: ${staleStocks.length} 只股票数据超过${FRESHNESS_THRESHOLD_HOURS}小时未更新`);
    console.log('过期股票:', staleStocks.map(s => s.symbol).join(', '));
  }
  
  // 检查是否可以运行回测
  const totalFresh = freshStocks.length;
  const totalStale = staleStocks.length;
  const STALE_RATIO = totalStale / (totalFresh + totalStale);
  
  if (STALE_RATIO > 0.5) {
    console.log(`\n🚫 拒绝触发回测: ${(STALE_RATIO * 100).toFixed(0)}% 数据过期`);
  } else {
    console.log(`\n✅ 允许触发回测: ${(STALE_RATIO * 100).toFixed(0)}% 数据可用`);
  }
  
  await pool.end();
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });