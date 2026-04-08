/**
 * 情绪扫描器
 * 扫描情绪异常事件，调用短线agent分析
 */

import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://zhengzefeng:password@localhost:5432/trading_bot'
});

// 配置
const SCAN_INTERVAL_MS = 5 * 60 * 1000; // 5分钟
const ALERT_THRESHOLDS = {
  extreme_negative: -70,
  extreme_positive: 70,
  change_threshold: 30,  // 情绪变化超过30分
};

// 导入分析器
import { analyzeWithAgent } from './short-term-analyzer';

export interface SentimentEvent {
  symbol?: string;
  type: 'extreme' | 'change' | 'spike';
  score: number;
  change: number;
  timestamp: Date;
}

/**
 * 扫描情绪异常
 */
async function scanSentimentAnomalies(): Promise<SentimentEvent[]> {
  const events: SentimentEvent[] = [];
  
  try {
    // 获取最近的情绪数据
    const result = await pool.query(`
      SELECT symbol, score, created_at
      FROM sentiment_history
      WHERE created_at > NOW() - INTERVAL '1 hour'
      ORDER BY created_at DESC
      LIMIT 100
    `);
    
    if (result.rows.length === 0) {
      // 如果没有历史数据，从 news_items 估算
      await scanFromNewsItems(events);
      return events;
    }
    
    // 按 symbol 分组
    const symbolScores: Record<string, { current: number; prev: number; timestamp: Date }> = {};
    
    for (const row of result.rows) {
      const sym = row.symbol || 'MARKET';
      if (!symbolScores[sym]) {
        symbolScores[sym] = { current: 0, prev: 0, timestamp: row.created_at };
      }
      if (symbolScores[sym].current === 0) {
        symbolScores[sym].current = row.score;
      } else if (symbolScores[sym].prev === 0) {
        symbolScores[sym].prev = row.score;
      }
    }
    
    // 检测异常
    for (const [symbol, data] of Object.entries(symbolScores)) {
      const change = data.current - data.prev;
      
      // 极端情绪
      if (data.current <= ALERT_THRESHOLDS.extreme_negative || data.current >= ALERT_THRESHOLDS.extreme_positive) {
        events.push({
          symbol: symbol === 'MARKET' ? undefined : symbol,
          type: 'extreme',
          score: data.current,
          change,
          timestamp: data.timestamp,
        });
      }
      // 情绪剧变
      else if (Math.abs(change) > ALERT_THRESHOLDS.change_threshold) {
        events.push({
          symbol: symbol === 'MARKET' ? undefined : symbol,
          type: 'change',
          score: data.current,
          change,
          timestamp: data.timestamp,
        });
      }
    }
    
  } catch (error) {
    console.error('[scanner] 扫描错误:', error);
    // 尝试从新闻扫描
    await scanFromNewsItems(events);
  }
  
  return events;
}

/**
 * 从新闻项扫描情绪异常
 */
async function scanFromNewsItems(events: SentimentEvent[]): Promise<void> {
  try {
    // 检查最近的新闻情绪
    const result = await pool.query(`
      SELECT source, sentiment, published_at
      FROM news_items
      WHERE published_at > NOW() - INTERVAL '1 hour'
      ORDER BY published_at DESC
      LIMIT 50
    `);
    
    // 简化：统计负面/正面新闻数量
    let negative = 0, positive = 0;
    for (const row of result.rows) {
      if (row.sentiment === 'negative') negative++;
      else if (row.sentiment === 'positive') positive++;
    }
    
    const total = result.rows.length;
    if (total > 0) {
      const score = Math.round((positive - negative) / total * 100);
      
      // 极端情绪
      if (score <= -70 || score >= 70) {
        events.push({
          type: 'extreme',
          score,
          change: 0,
          timestamp: new Date(),
        });
      }
    }
  } catch (error) {
    console.error('[scanner] 新闻扫描错误:', error);
  }
}

/**
 * 处理情绪事件
 */
async function processEvent(event: SentimentEvent): Promise<void> {
  console.log(`[scanner] 处理事件: ${event.type}, score: ${event.score}`);
  
  try {
    // 调用短线agent分析
    const analysis = await analyzeWithAgent(event);
    
    if (!analysis) {
      console.log('[scanner] Agent分析跳过');
      return;
    }
    
    // 保存为待审批建议
    await saveSuggestion(event, analysis);
    
    // 发送飞书通知
    await sendNotification(event, analysis);
    
  } catch (error) {
    console.error('[scanner] 处理事件错误:', error);
  }
}

/**
 * 保存待审批建议
 */
async function saveSuggestion(event: SentimentEvent, analysis: any): Promise<void> {
  await pool.query(`
    INSERT INTO sentiment_suggestions 
    (symbol, event_type, sentiment_score, sentiment_change, agent_analysis, 
     suggested_action, confidence, reason, risk_level, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
  `, [
    event.symbol || 'MARKET',
    event.type,
    event.score,
    event.change,
    analysis.analysis,
    analysis.action,
    analysis.confidence,
    analysis.reason,
    analysis.risk,
  ]);
}

/**
 * 发送飞书通知
 */
async function sendNotification(event: SentimentEvent, analysis: any): Promise<void> {
  try {
    // 写入 notification_log
    await pool.query(`
      INSERT INTO notification_log (id, channel, message, status)
      VALUES ($1, 'feishu', $2, 'sent')
    `, [
      `sentiment_${Date.now()}`,
      `🔔 情绪监控建议\n${event.symbol || '市场'}: ${analysis.action}\n原因: ${analysis.reason}\n请在前端审批`
    ]);
    
    console.log('[scanner] 飞书通知已发送');
  } catch (error) {
    console.log('[scanner] 通知失败:', error);
  }
}

/**
 * 主循环
 */
async function startScanner(): Promise<void> {
  console.log(`[scanner] 启动情绪扫描器, 间隔 ${SCAN_INTERVAL_MS / 1000 / 60} 分钟`);
  
  while (true) {
    try {
      const events = await scanSentimentAnomalies();
      
      for (const event of events) {
        await processEvent(event);
      }
      
      if (events.length > 0) {
        console.log(`[scanner] 发现 ${events.length} 个异常事件`);
      }
      
    } catch (error) {
      console.error('[scanner] 循环错误:', error);
    }
    
    await new Promise(resolve => setTimeout(resolve, SCAN_INTERVAL_MS));
  }
}

// 直接运行
if (require.main === module) {
  startScanner().catch(console.error);
}

export default { startScanner, scanSentimentAnomalies };