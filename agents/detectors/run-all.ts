#!/usr/bin/env node
/**
 * 异常检测调度器
 * 每小时运行所有检测器
 */

const DETECTORS = [
  { name: 'strategy-drift', script: './strategy-drift-detector' },
  { name: 'data-gap', script: './data-gap-detector' },
  { name: 'position-anomaly', script: './position-anomaly-detector' }
];

async function runAllDetectors() {
  console.log(`[detector-runner] ${new Date().toISOString()} 开始运行检测器...`);
  
  let totalDetected = 0;
  
  for (const detector of DETECTORS) {
    try {
      console.log(`[detector-runner] 运行 ${detector.name}...`);
      
      // 动态导入并运行检测器
      const mod = await import(detector.script);
      const result = await mod.default();
      
      console.log(`[detector-runner] ${detector.name}: ${result.detected} 个异常`);
      totalDetected += result.detected;
      
    } catch (error) {
      console.error(`[detector-runner] ${detector.name} 错误:`, error);
    }
  }
  
  console.log(`[detector-runner] 总计: ${totalDetected} 个异常`);
  return totalDetected;
}

// 直接运行
if (require.main === module) {
  runAllDetectors()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('错误:', error);
      process.exit(1);
    });
}

export default runAllDetectors;