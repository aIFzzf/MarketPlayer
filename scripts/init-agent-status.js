const { Client } = require('pg');
const client = new Client({ host: 'localhost', port: 5432, user: 'trading_user', password: 'password', database: 'trading_bot' });

async function main() {
  await client.connect();
  
  // 检查 agent_status 表是否存在
  const t = await client.query("SELECT table_name FROM information_schema.tables WHERE table_name = 'agent_status'");
  if (t.rows.length === 0) {
    await client.query(`
      CREATE TABLE agent_status (
        id SERIAL PRIMARY KEY,
        agent_name TEXT NOT NULL,
        status TEXT,
        last_task TEXT,
        last_active TIMESTAMP,
        metrics JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ agent_status 表已创建');
  } else {
    console.log('表已存在');
  }
  
  await client.end();
}

main().catch(e => console.error(e.message));
