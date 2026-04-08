/**
 * 情绪量化模块
 * 将新闻情绪量化为可交易的分数 (-100 到 +100)
 */

import pg from 'pg';

const { Pool } = pg;

let pool: any;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://zhengzefeng:password@localhost:5432/trading_bot'
    });
  }
  return pool;
}

// 来源可信度
const SOURCE_CREDIBILITY: Record<string, number> = {
  'yahoo_finance': 1.0,
  'yahoo_finance_us': 1.0,
  'eastmoney': 0.9,
  'sina_finance': 0.8,
  'gdelt': 0.7,
  'xueqiu': 0.85,
  'default': 0.7,
};

// 默认可信度
const DEFAULT_CREDIBILITY = 0.7;

// 时效性衰减参数
const DECAY_HALF_LIFE_HOURS = 24;
const DECAY_FACTOR = 0.5;

/**
 * 获取新闻
 */
async function getNewsForSymbol(symbol: string, hours: number = 72): Promise<any[]> {
  const result = await getPool().query(`
    SELECT id, title, source, published_at, sentiment, market
    FROM news_items
    WHERE (title LIKE $1 OR content LIKE $1 OR symbols LIKE $1)
    AND published_at > NOW() - INTERVAL '${hours} hours'
    ORDER BY published_at DESC
    LIMIT 100
  `, [`%${symbol}%`]);
  
  return result.rows;
}

/**
 * 获取全局新闻 (不限定symbol)
 */
async function getGlobalNews(hours: number = 72): Promise<any[]> {
  const result = await getPool().query(`
    SELECT id, title, source, published_at, sentiment, market
    FROM news_items
    WHERE published_at > NOW() - INTERVAL '${hours} hours'
    ORDER BY published_at DESC
    LIMIT 200
  `);
  
  return result.rows;
}

/**
 * 计算单条新闻的情绪贡献
 */
function calculateNewsSentiment(news: any): number {
  // 基础分数
  let score = 0;
  
  switch (news.sentiment) {
    case 'positive':
      score = 50;
      break;
    case 'negative':
      score = -50;
      break;
    case 'neutral':
    default:
      score = 0;
      break;
  }
  
  // 来源可信度
  const credibility = SOURCE_CREDIBILITY[news.source] || DEFAULT_CREDIBILITY;
  score *= credibility;
  
  return score;
}

/**
 * 计算时效性衰减
 */
function getTimeDecay(publishedAt: Date): number {
  const now = new Date();
  const hoursAgo = (now.getTime() - new Date(publishedAt).getTime()) / (1000 * 60 * 60);
  
  if (hoursAgo <= 0) {
    return 1.0;
  }
  
  // 指数衰减
  return Math.pow(DECAY_FACTOR, hoursAgo / DECAY_HALF_LIFE_HOURS);
}

/**
 * 量化情绪分数 (-100 到 +100)
 */
export async function quantifySentiment(symbol?: string): Promise<{
  score: number;
  count: number;
  positive: number;
  negative: number;
  neutral: number;
  sources: Record<string, number>;
  latest_news: any[];
}> {
  const news = symbol 
    ? await getNewsForSymbol(symbol)
    : await getGlobalNews();
  
  if (news.length === 0) {
    return {
      score: 0,
      count: 0,
      positive: 0,
      negative: 0,
      neutral: 0,
      sources: {},
      latest_news: [],
    };
  }
  
  let totalScore = 0;
  let positive = 0;
  let negative = 0;
  let neutral = 0;
  const sourceCounts: Record<string, number> = {};
  const latestNews: any[] = [];
  
  for (const n of news) {
    // 时效性衰减
    const decay = getTimeDecay(n.published_at);
    
    // 计算情绪贡献
    const newsScore = calculateNewsSentiment(n) * decay;
    totalScore += newsScore;
    
    // 统计
    if (n.sentiment === 'positive') {
      positive++;
    } else if (n.sentiment === 'negative') {
      negative++;
    } else {
      neutral++;
    }
    
    // 来源统计
    sourceCounts[n.source] = (sourceCounts[n.source] || 0) + 1;
    
    // 保存最新新闻
    if (latestNews.length < 5) {
      latestNews.push({
        title: n.title,
        source: n.source,
        sentiment: n.sentiment,
        published_at: n.published_at,
        score: newsScore,
      });
    }
  }
  
  // 归一化到 -100 到 +100
  const normalizedScore = Math.max(-100, Math.min(100, totalScore));
  
  return {
    score: normalizedScore,
    count: news.length,
    positive,
    negative,
    neutral,
    sources: sourceCounts,
    latest_news: latestNews,
  };
}

/**
 * 计算情绪变化率 (momentum)
 */
export async function calculateMomentum(symbol?: string, periods: number = 5): Promise<{
  current: number;
  previous: number;
  momentum: number;
  trend: 'improving' | 'declining' | 'stable';
}> {
  // 获取多个时间段的情绪
  const scores: number[] = [];
  
  for (const hours of [24, 48, 72, 96, 120]) {
    const sentiment = symbol 
      ? await quantifySentiment(symbol)
      : await quantifySentiment();
    scores.push(sentiment.score);
  }
  
  if (scores.length < 2) {
    return {
      current: scores[0] || 0,
      previous: 0,
      momentum: 0,
      trend: 'stable',
    };
  }
  
  const current = scores[0];
  const previous = scores[Math.min(periods - 1, scores.length - 1)];
  const momentum = current - previous;
  
  let trend: 'improving' | 'declining' | 'stable' = 'stable';
  if (momentum > 10) {
    trend = 'improving';
  } else if (momentum < -10) {
    trend = 'declining';
  }
  
  return {
    current,
    previous,
    momentum,
    trend,
  };
}

/**
 * 获取市场的整体情绪
 */
export async function getMarketSentiment(): Promise<{
  score: number;
  momentum: number;
  trend: 'improving' | 'declining' | 'stable';
  symbols: Record<string, number>;
}> {
  const sentiment = await quantifySentiment();
  const momentumData = await calculateMomentum();
  
  // 统计各 symbol 的情绪
  const symbolScores: Record<string, number> = {};
  
  // 从 news_items 获取有 symbol 标签的新闻
  const result = await pool.query(`
    SELECT symbols, sentiment 
    FROM news_items
    WHERE published_at > NOW() - INTERVAL '24 hours'
    AND symbols IS NOT NULL
    LIMIT 100
  `);
  
  for (const row of result.rows) {
    if (!row.symbols) continue;
    
    const symbols = row.symbols.split(',').map((s: string) => s.trim());
    const score = row.sentiment === 'positive' ? 1 : row.sentiment === 'negative' ? -1 : 0;
    
    for (const sym of symbols) {
      symbolScores[sym] = (symbolScores[sym] || 0) + score;
    }
  }
  
  return {
    score: sentiment.score,
    momentum: momentumData.momentum,
    trend: momentumData.trend,
    symbols: symbolScores,
  };
}

// 测试
if (require.main === module) {
  quantifySentiment().then(result => {
    console.log('情绪分数:', result.score);
    console.log('新闻数量:', result.count);
    console.log('正面:', result.positive, '负面:', result.negative, '中性:', result.neutral);
    pool.end();
  }).catch(console.error);
}

export default quantifySentiment;