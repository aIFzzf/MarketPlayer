/**
 * Agent 状态同步脚本
 * 所有 agent 定期调用此脚本更新状态到数据库
 * 然后 commander 统一汇总汇报给用户
 */

const { Client } = require('pg');
const client = new Client({ host: 'localhost', port: 5432, user: 'trading_user', password: 'password', database: 'trading_bot' });

const AGENT_NAME = process.argv[2] || 'unknown';
const STATUS = process.argv[3] || 'idle';
const TASK = process.argv[4] || '';
const METRICS = process.argv[5] || '{}';

async function main() {
  await client.connect();
  
  // 更新或插入 agent 状态
  await client.query(`
    INSERT INTO agent_status (agent_name, status, last_task, last_active, metrics, created_at)
    VALUES ($1, $2, $3, NOW(), $4::jsonb, NOW())
    ON CONFLICT (agent_name) DO UPDATE SET
      status = EXCLUDED.status,
      last_task = EXCLUDED.last_task,
      last_active = NOW(),
      metrics = EXCLUDED.metrics
  `, [AGENT_NAME, STATUS, TASK, METRICS]);
  
  console.log(`✅ ${AGENT_NAME} 状态已更新: ${STATUS}`);
  
  await client.end();
}

main().catch(e => console.error(e.message));
