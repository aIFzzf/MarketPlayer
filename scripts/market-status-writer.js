/**
 * market-status-writer.js (从文件读取 SPY 数据)
 * 自动将 SPY market_status 写入数据库
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DATA_DIR = '/Users/zhengzefeng/.openclaw/workspace/MarketPlayer/data/cache/klines';
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://trading_user:password@localhost:5432/trading_bot' });

function determineMarketStatus(change20d) {
  if (change20d === null) return 'caution';
  if (change20d >= -0.08) return 'risk_on';     // 20天跌幅 < 8%
  if (change20d >= -0.15) return 'caution';       // 20天跌幅 < 15%
  return 'risk_off';                               // 20天跌幅 >= 15%
}

function loadSPYFromFile() {
  const filePath = path.join(DATA_DIR, 'us_SPY.json');
  
  if (!fs.existsSync(filePath)) {
    console.log('⚠️ SPY 数据文件不存在:', filePath);
    return null;
  }
  
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const klines = Array.isArray(data) ? data : data.klines || [];
    
    if (klines.length === 0) return null;
    
    // 最新价格
    const latest = klines[klines.length - 1];
    const currentPrice = latest.close;
    
    // 20天前价格
    const index20d = klines.length - 21;
    const price20dAgo = index20d >= 0 ? klines[index20d].close : null;
    
    const change20d = price20dAgo !== null 
      ? (currentPrice - price20dAgo) / price20dAgo 
      : null;
    
    return {
      price: currentPrice,
      date: latest.date,
      change20d,
    };
  } catch (e) {
    console.error('读取 SPY 文件失败:', e.message);
    return null;
  }
}

async function updateMarketStatus() {
  try {
    const spyData = loadSPYFromFile();
    
    if (!spyData) {
      console.log('⚠️ 无法获取 SPY 数据');
      return;
    }
    
    const status = determineMarketStatus(spyData.change20d);
    
    // 检查最近1小时是否有记录
    const existing = await pool.query(`
      SELECT id FROM market_status 
      WHERE market = 'us' 
      AND updated_at > NOW() - INTERVAL '1 hour'
    `);
    
    if (existing.rows.length > 0) {
      // 更新
      await pool.query(`
        UPDATE market_status SET
          spy_price = $1,
          change_20d = $2,
          status = $3,
          updated_at = NOW()
        WHERE id = $4
      `, [spyData.price, spyData.change20d, status, existing.rows[0].id]);
    } else {
      // 插入
      await pool.query(`
        INSERT INTO market_status (market, spy_price, change_20d, status, updated_at)
        VALUES ('us', $1, $2, $3, NOW())
      `, [spyData.price, spyData.change20d, status]);
    }
    
    console.log(`✅ Market status updated:`);
    console.log(`   SPY: ${spyData.price.toFixed(2)}`);
    console.log(`   20日变化: ${(spyData.change20d || 0) * 100?.toFixed(1)}%`);
    console.log(`   状态: ${status}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

updateMarketStatus();