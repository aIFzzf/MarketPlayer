#!/usr/bin/env node
/**
 * 运行一次情绪监控检查（测试用）
 */

import { runCheck } from '../dist/sentiment/monitor-service.js';

console.log('运行情绪监控检查（单次）...\n');

runCheck()
  .then(() => {
    console.log('\n✅ 检查完成');
    process.exit(0);
  })
  .catch((error) => {
    console.error('检查失败:', error);
    process.exit(1);
  });
