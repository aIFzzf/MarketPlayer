/**
 * 检查情绪数据状态
 */

const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'trading_bot',
  user: 'zhengzefeng',
  password: 'password'
});

async function checkSentimentData() {
  console.log('='.repeat(60));
  console.log('情绪数据状态检查');
  console.log('='.repeat(60));
  console.log();

  try {
    // 1. 基本统计
    console.log('1. 基本统计...');
    const stats = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(DISTINCT symbol) as symbols,
        MIN(created_at) as earliest,
        MAX(created_at) as latest
      FROM sentiment_history
    `);

    const row = stats.rows[0];
    console.log(`   总记录数: ${row.total}`);
    console.log(`   覆盖股票: ${row.symbols}`);
    console.log(`   时间范围: ${row.earliest} 到 ${row.latest}`);

    // 计算天数
    const days = Math.ceil((new Date(row.latest) - new Date(row.earliest)) / (1000 * 60 * 60 * 24));
    console.log(`   时间跨度: ${days} 天`);
    console.log();

    // 2. 情绪分布
    console.log('2. 情绪分布...');
    const distribution = await pool.query(`
      SELECT
        CASE
          WHEN score > 0 THEN 'positive'
          WHEN score < 0 THEN 'negative'
          ELSE 'neutral'
        END as sentiment_type,
        COUNT(*) as count
      FROM sentiment_history
      GROUP BY sentiment_type
      ORDER BY count DESC
    `);

    const total = distribution.rows.reduce((sum, r) => sum + parseInt(r.count), 0);
    distribution.rows.forEach(r => {
      const pct = (r.count * 100 / total).toFixed(1);
      console.log(`   ${r.sentiment_type}: ${r.count} (${pct}%)`);
    });
    console.log();

    // 3. 数据质量评估
    console.log('3. 数据质量评估...');

    const minRecords = 1000;
    const minSymbols = 10;
    const minDays = 90;

    const checks = [
      { name: '记录数量', value: row.total, threshold: minRecords, pass: row.total >= minRecords },
      { name: '股票覆盖', value: row.symbols, threshold: minSymbols, pass: row.symbols >= minSymbols },
      { name: '时间跨度', value: days, threshold: minDays, pass: days >= minDays },
    ];

    checks.forEach(check => {
      const status = check.pass ? '✅' : '❌';
      console.log(`   ${status} ${check.name}: ${check.value} (需要 >= ${check.threshold})`);
    });
    console.log();

    // 4. 回测可行性
    const allPass = checks.every(c => c.pass);
    console.log('4. 回测可行性...');
    if (allPass) {
      console.log('   ✅ 数据充足，可以进行完整回测');
    } else {
      console.log('   ⚠️  数据不足，建议继续积累数据');
      console.log('   建议：');
      if (row.total < minRecords) {
        console.log(`     - 继续积累新闻数据（当前 ${row.total}，目标 ${minRecords}+）`);
      }
      if (row.symbols < minSymbols) {
        console.log(`     - 扩大股票覆盖范围（当前 ${row.symbols}，目标 ${minSymbols}+）`);
      }
      if (days < minDays) {
        console.log(`     - 等待更长时间跨度（当前 ${days}天，目标 ${minDays}+天）`);
      }
    }
    console.log();

    // 5. Top 10 股票情绪统计
    console.log('5. Top 10 股票情绪统计...');
    const topSymbols = await pool.query(`
      SELECT
        symbol,
        COUNT(*) as count,
        AVG(score) as avg_score,
        MIN(created_at) as earliest,
        MAX(created_at) as latest
      FROM sentiment_history
      GROUP BY symbol
      ORDER BY count DESC
      LIMIT 10
    `);

    topSymbols.rows.forEach((r, i) => {
      const avgScore = parseFloat(r.avg_score).toFixed(1);
      const sentiment = avgScore > 10 ? '正面' : avgScore < -10 ? '负面' : '中性';
      console.log(`   ${i+1}. ${r.symbol}: ${r.count}条记录, 平均分${avgScore} (${sentiment})`);
    });
    console.log();

    console.log('='.repeat(60));
    console.log('检查完成');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('错误:', error.message);
  } finally {
    await pool.end();
  }
}

checkSentimentData();
