const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://trading_user:password@localhost:5432/trading_bot' });

async function main() {
  // 1. 读取learning_actions最近记录
  const actions = await pool.query('SELECT * FROM learning_actions ORDER BY created_at DESC LIMIT 5');
  console.log('📋 learning_actions 最近记录:', actions.rowCount);
  if (actions.rows.length > 0) {
    console.log(JSON.stringify(actions.rows[0], null, 2));
  }
  
  // 2. 检查strategy_positions表结构
  const positions = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'strategy_positions' ORDER BY ordinal_position");
  console.log('\n📋 strategy_positions 表结构:');
  console.log(positions.rows);
  
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });