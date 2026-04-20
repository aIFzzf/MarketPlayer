/**
 * market-status-writer.ts
 * 
 * 监听市场数据变化，自动将 SPY market_status 写入数据库
 * 供其他 agent 查询
 */

import pg from 'pg';
import { config } from '../config';
import { logger } from '../utils/logger';

const { Pool } = pg;
let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: config.DATABASE_URL,
    });
  }
  return pool;
}

// 市场状态阈值
const MARKET_THRESHOLDS = {
  risk_on: { max20dDrop: -0.08 },  // 20天跌幅 < 8%
  caution: { max20dDrop: -0.15 },  // 20天跌幅 < 15%
  risk_off: { min20dDrop: -0.15 }, // 20天跌幅 >= 15%
};

interface MarketData {
  symbol: string;
  price: number;
  ma50: number | null;
  change20d: number | null;
  vix: number | null;
  updatedAt: Date;
}

/**
 * 判断市场状态
 */
function determineMarketStatus(change20d: number | null, vix: number | null): 'risk_on' | 'caution' | 'risk_off' {
  if (change20d === null) return 'caution';
  
  if (change20d >= MARKET_THRESHOLDS.risk_on.max20dDrop) {
    return 'risk_on';
  } else if (change20d >= MARKET_THRESHOLDS.caution.max20dDrop) {
    return 'caution';
  } else {
    return 'risk_off';
  }
}

/**
 * 从 klines 表获取 SPY 最新数据
 */
export async function fetchSPYFromDB(): Promise<MarketData | null> {
  try {
    const result = await getPool().query(`
      SELECT 
        close as price,
        timestamp as updated_at
      FROM us_spy_klines
      ORDER BY timestamp DESC
      LIMIT 1
    `);
    
    if (result.rows.length === 0) return null;
    
    // 获取20日前价格计算变化
    const result20d = await getPool().query(`
      SELECT close as price
      FROM us_spy_klines
      ORDER BY timestamp DESC
      OFFSET 20
      LIMIT 1
    `);
    
    const currentPrice = result.rows[0].price;
    const change20d = result20d.rows.length > 0 
      ? (currentPrice - result20d.rows[0].price) / result20d.rows[0].price 
      : null;
    
    return {
      symbol: 'SPY',
      price: currentPrice,
      ma50: null, // 可扩展计算 MA50
      change20d,
      vix: null, // 需单独获取 VIX
      updatedAt: result.rows[0].updated_at,
    };
  } catch (error) {
    logger.error('fetchSPYFromDB error:', error);
    return null;
  }
}

/**
 * 将 market_status 写入数据库
 */
export async function writeMarketStatus(marketData: MarketData): Promise<boolean> {
  try {
    const status = determineMarketStatus(marketData.change20d, marketData.vix);
    
    // 检查是否已存在今天的记录
    const existing = await getPool().query(`
      SELECT id FROM market_status 
      WHERE symbol = 'SPY' 
      AND updated_at > NOW() - INTERVAL '1 hour'
    `);
    
    if (existing.rows.length > 0) {
      // 更新现有记录
      await getPool().query(`
        UPDATE market_status SET
          spy_price = $1,
          ma50 = $2,
          change_20d = $3,
          status = $4,
          updated_at = NOW()
        WHERE id = $5
      `, [marketData.price, marketData.ma50, marketData.change20d, status, existing.rows[0].id]);
    } else {
      // 插入新记录
      await getPool().query(`
        INSERT INTO market_status (symbol, spy_price, ma50, change_20d, market, status, updated_at)
        VALUES ('SPY', $1, $2, $3, 'us', $4, NOW())
      `, [marketData.price, marketData.ma50, marketData.change20d, status]);
    }
    
    logger.info(`[market-status-writer] SPY: price=${marketData.price}, change20d=${(marketData.change20d || 0)*100}%, status=${status}`);
    return true;
  } catch (error) {
    logger.error('writeMarketStatus error:', error);
    return false;
  }
}

/**
 * 主函数：获取 SPY 数据并写入 DB
 */
export async function updateMarketStatus(): Promise<MarketData | null> {
  const marketData = await fetchSPYFromDB();
  
  if (marketData) {
    await writeMarketStatus(marketData);
  }
  
  return marketData;
}

/**
 * 获取当前市场状态（从 DB 查询）
 */
export async function getCurrentMarketStatus(): Promise<{
  status: 'risk_on' | 'caution' | 'risk_off';
  spyPrice: number;
  change20d: number | null;
  updatedAt: Date;
} | null> {
  try {
    const result = await getPool().query(`
      SELECT status, spy_price, change_20d, updated_at
      FROM market_status
      WHERE symbol = 'SPY'
      ORDER BY updated_at DESC
      LIMIT 1
    `);
    
    if (result.rows.length === 0) return null;
    
    return {
      status: result.rows[0].status,
      spyPrice: result.rows[0].spy_price,
      change20d: result.rows[0].change_20d,
      updatedAt: result.rows[0].updated_at,
    };
  } catch (error) {
    logger.error('getCurrentMarketStatus error:', error);
    return null;
  }
}

// 单独运行
if (require.main === module) {
  updateMarketStatus()
    .then(data => {
      if (data) {
        console.log('✅ Market status updated:', data);
      } else {
        console.log('⚠️ No SPY data available');
      }
      process.exit(0);
    })
    .catch(e => {
      console.error('Error:', e.message);
      process.exit(1);
    });
}

export default {
  updateMarketStatus,
  getCurrentMarketStatus,
};