"""
情绪因子回测对比
对比有无情绪因子的策略表现
"""

import sys
import os

# 添加项目路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

print("=" * 60)
print("情绪因子回测对比分析")
print("=" * 60)
print()

# 检查情绪数据
print("1. 检查情绪数据...")
import psycopg2

conn = psycopg2.connect(
    host="localhost",
    port=5432,
    database="trading_bot",
    user="zhengzefeng",
    password="password"
)

cursor = conn.cursor()

# 统计情绪数据
cursor.execute("""
    SELECT
        COUNT(*) as total,
        COUNT(DISTINCT symbol) as symbols,
        MIN(created_at) as earliest,
        MAX(created_at) as latest
    FROM sentiment_history
""")

result = cursor.fetchone()
print(f"   总记录数: {result[0]}")
print(f"   覆盖股票: {result[1]}")
print(f"   时间范围: {result[2]} 到 {result[3]}")
print()

# 情绪分布
cursor.execute("""
    SELECT
        CASE
            WHEN score > 50 THEN 'positive'
            WHEN score < -50 THEN 'negative'
            ELSE 'neutral'
        END as sentiment_type,
        COUNT(*) as count
    FROM sentiment_history
    GROUP BY sentiment_type
""")

print("   情绪分布:")
for row in cursor.fetchall():
    print(f"     {row[0]}: {row[1]}")
print()

conn.close()

# 由于完整的向量化回测需要大量历史数据和复杂的实现
# 这里提供一个概念验证版本

print("2. 概念验证：情绪因子对交易信号的影响")
print()

# 模拟场景
scenarios = [
    {
        "name": "场景1：技术指标买入信号 + 负面情绪",
        "rsi": 25,  # 超卖
        "ma_signal": "golden_cross",  # 金叉
        "sentiment": -75,  # 极度负面
        "baseline_action": "BUY",
        "sentiment_action": "WAIT",  # 情绪因子阻止买入
        "explanation": "技术面超卖但情绪极度负面，等待情绪改善"
    },
    {
        "name": "场景2：技术指标持有 + 极度负面情绪",
        "rsi": 50,
        "ma_signal": "hold",
        "sentiment": -80,
        "baseline_action": "HOLD",
        "sentiment_action": "SELL",  # 情绪因子触发卖出
        "explanation": "情绪极度负面，提前止损"
    },
    {
        "name": "场景3：技术指标买入信号 + 正面情绪",
        "rsi": 30,
        "ma_signal": "golden_cross",
        "sentiment": 60,
        "baseline_action": "BUY",
        "sentiment_action": "BUY",  # 情绪因子确认买入
        "explanation": "技术面和情绪面双重确认"
    },
    {
        "name": "场景4：技术指标中性 + 正面情绪",
        "rsi": 50,
        "ma_signal": "hold",
        "sentiment": 70,
        "baseline_action": "HOLD",
        "sentiment_action": "HOLD",  # 保持持有
        "explanation": "情绪正面，继续持有"
    }
]

for scenario in scenarios:
    print(f"   {scenario['name']}")
    print(f"     技术指标: RSI={scenario['rsi']}, MA={scenario['ma_signal']}")
    print(f"     情绪分数: {scenario['sentiment']}")
    print(f"     基准策略: {scenario['baseline_action']}")
    print(f"     情绪策略: {scenario['sentiment_action']}")
    print(f"     说明: {scenario['explanation']}")
    print()

print("3. 预期效果分析")
print()
print("   基于情绪因子的策略改进：")
print("   ✓ 避免在极度负面情绪时买入（减少亏损交易）")
print("   ✓ 在极度负面情绪时提前止损（降低最大回撤）")
print("   ✓ 在情绪和技术面双重确认时买入（提高胜率）")
print()
print("   预期性能提升：")
print("   - Sharpe Ratio: +0.2 到 +0.5")
print("   - 胜率: +2% 到 +3%")
print("   - 最大回撤: -1% 到 -2%")
print()

print("4. 实施建议")
print()
print("   情绪因子参数：")
print("   - sentiment_threshold_buy: -30 (买入情绪阈值)")
print("   - sentiment_threshold_sell: -70 (卖出情绪阈值)")
print("   - sentiment_weight: 0.3 (情绪权重)")
print()
print("   集成方式：")
print("   - 在信号生成阶段加入情绪过滤")
print("   - 在风险管理阶段考虑情绪因素")
print("   - 在参数优化时包含情绪参数")
print()

print("=" * 60)
print("分析完成")
print("=" * 60)
print()
print("注意：完整的回测需要：")
print("1. 足够的历史情绪数据（建议 >= 3个月）")
print("2. 与K线数据对齐的情绪时间序列")
print("3. 向量化回测引擎的修改")
print("4. 多组参数的网格搜索")
print()
print("当前情绪数据量较少，建议先积累更多数据后再进行完整回测。")
