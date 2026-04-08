/**
 * 情绪扫描器
 * 扫描情绪异常事件并触发短线agent分析
 */

import pg from 'pg';
import { analyzeEvent, SentimentEvent } from '../agents/short-term-analyzer.js';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://zhengzefeng:password@localhost:5432/trading_bot'
});

// 扫描配置
const SCAN_CONFIG = {
  // 异常阈值
  extreme_negative_threshold: -70,
  extreme_positive_threshold: 70,
  change_threshold: 30,

  // 扫描间隔（毫秒）
  scan_interval: 5 * 60 * 1000, // 5分钟
};

/**
 * 获取监控股票列表
 */
async function getWatchlist(): Promise<string[]> {
  try {
    const result = await pool.query(`
      SELECT DISTINCT symbol FROM watchlist
      ORDER BY symbol
    `);

    if (result.rows.length > 0) {
      return result.rows.map(r => r.symbol);
    }
  } catch (error) {
    console.error('获取watchlist失败:', error);
  }

  // 降级：使用有情绪数据的股票
  try {
    const result = await pool.query(`
      SELECT DISTINCT symbol FROM sentiment_history
      WHERE symbol != 'MARKET'
      AND created_at >= NOW() - INTERVAL '7 days'
      ORDER BY symbol
      LIMIT 20
    `);
    return result.rows.map(r => r.symbol);
  } catch {
    return [];
  }
}

/**
 * 获取股票的情绪数据
 */
async function getSentimentData(symbol: string): Promise<{
  today_score: number;
  yesterday_score: number;
  momentum: number;
} | null> {
  try {
    const result = await pool.query(`
      SELECT
        score,
        created_at,
        LAG(score) OVER (ORDER BY created_at) as prev_score
      FROM sentiment_history
      WHERE symbol = $1
      AND created_at >= NOW() - INTERVAL '2 days'
      ORDER BY created_at DESC
      LIMIT 2
    `, [symbol]);

    if (result.rows.length === 0) {
      return null;
    }

    const today = result.rows[0];
    const yesterday = result.rows[1];

    return {
      today_score: today.score,
      yesterday_score: yesterday?.score || 0,
      momentum: today.score - (yesterday?.score || 0)
    };
  } catch (error) {
    console.error(`获取${symbol}情绪数据失败:`, error);
    return null;
  }
}

/**
 * 检测异常事件
 */
function detectAnomalies(symbol: string, data: {
  today_score: number;
  yesterday_score: number;
  momentum: number;
}): SentimentEvent | null {
  const { today_score, yesterday_score, momentum } = data;
  const change = today_score - yesterday_score;

  // 极度负面
  if (today_score <= SCAN_CONFIG.extreme_negative_threshold) {
    return {
      symbol,
      event_type: 'extreme_negative',
      sentiment_score: today_score,
      sentiment_change: change,
      momentum
    };
  }

  // 极度正面
  if (today_score >= SCAN_CONFIG.extreme_positive_threshold) {
    return {
      symbol,
      event_type: 'extreme_positive',
      sentiment_score: today_score,
      sentiment_change: change,
      momentum
    };
  }

  // 情绪剧烈变化
  if (Math.abs(change) >= SCAN_CONFIG.change_threshold) {
    return {
      symbol,
      event_type: 'trend_reversal',
      sentiment_score: today_score,
      sentiment_change: change,
      momentum
    };
  }

  return null;
}

/**
 * 检查是否已经有待审批的建议
 */
async function hasPendingSuggestion(symbol: string): Promise<boolean> {
  const result = await pool.query(`
    SELECT COUNT(*) as count
    FROM sentiment_suggestions
    WHERE symbol = $1
    AND status = 'pending'
    AND created_at >= NOW() - INTERVAL '24 hours'
  `, [symbol]);

  return parseInt(result.rows[0].count) > 0;
}

/**
 * 运行一次扫描
 */
export async function runScan(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log(`情绪扫描 - ${new Date().toLocaleString('zh-CN')}`);
  console.log('='.repeat(60));

  try {
    // 获取监控列表
    const watchlist = await getWatchlist();
    console.log(`\n监控股票: ${watchlist.length} 只`);

    if (watchlist.length === 0) {
      console.log('⚠️  监控列表为空');
      return;
    }

    let eventCount = 0;
    let suggestionCount = 0;

    // 逐个扫描
    for (const symbol of watchlist) {
      try {
        // 获取情绪数据
        const data = await getSentimentData(symbol);
        if (!data) {
          continue;
        }

        // 检测异常
        const event = detectAnomalies(symbol, data);
        if (!event) {
          continue;
        }

        eventCount++;
        console.log(`\n🚨 发现异常: ${symbol} - ${event.event_type}`);
        console.log(`   情绪: ${event.sentiment_score}, 变化: ${event.sentiment_change}`);

        // 检查是否已有待审批建议
        const hasPending = await hasPendingSuggestion(symbol);
        if (hasPending) {
          console.log(`   ⏭️  跳过: 已有待审批建议`);
          continue;
        }

        // 调用agent分析
        await analyzeEvent(event);
        suggestionCount++;

      } catch (error) {
        console.error(`处理${symbol}失败:`, error);
      }
    }

    console.log(`\n✅ 扫描完成`);
    console.log(`   发现异常: ${eventCount} 个`);
    console.log(`   生成建议: ${suggestionCount} 个`);

  } catch (error) {
    console.error('扫描失败:', error);
  }
}

/**
 * 启动定时扫描
 */
export async function startScanner(): Promise<void> {
  console.log('🚀 情绪扫描器启动');
  console.log(`扫描间隔: ${SCAN_CONFIG.scan_interval / 1000 / 60} 分钟`);
  console.log(`异常阈值: 负面<${SCAN_CONFIG.extreme_negative_threshold}, 正面>${SCAN_CONFIG.extreme_positive_threshold}, 变化>${SCAN_CONFIG.change_threshold}`);
  console.log();

  // 立即运行一次
  await runScan();

  // 定时运行
  setInterval(async () => {
    await runScan();
  }, SCAN_CONFIG.scan_interval);

  console.log('\n✅ 扫描器运行中...');
}

// 启动
if (require.main === module) {
  startScanner().catch(console.error);
}
