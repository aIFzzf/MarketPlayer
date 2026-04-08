"""
情绪因子回测对比
对比基准策略 vs 情绪增强策略
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'vectorized'))

import asyncpg
import asyncio
import json
from datetime import datetime, timedelta
from core.engine import BacktestEngine
from core.data_loader import DataLoader
from core.strategy import Strategy

# 数据库配置
DB_CONFIG = {
    "host": "localhost",
    "port": 5432,
    "database": "trading_bot",
    "user": "zhengzefeng",
    "password": "password",
}

# 情绪阈值配置
SENTIMENT_CONFIG = {
    "short": {
        "sell_threshold": -70,    # 情绪 < -70 时减仓
        "wait_threshold": 70,     # 情绪 > 70 且 RSI > 70 时等待
        "rsi_overbought": 70
    },
    "long": {
        "trend_threshold": -20,   # 30日情绪趋势 < -20 时降低权重
        "weight_reduction": 0.3   # 降低30%权重
    }
}


class SentimentStrategy(Strategy):
    """情绪增强策略"""

    def __init__(self, params, conn):
        super().__init__(params)
        self.conn = conn

    async def get_sentiment_score(self, symbol, date):
        """获取情绪分数"""
        result = await self.conn.fetchrow("""
            SELECT score
            FROM sentiment_history
            WHERE symbol = $1
            AND DATE(created_at) = DATE($2)
            ORDER BY created_at DESC
            LIMIT 1
        """, symbol, date)

        return result['score'] if result else 0

    async def get_sentiment_trend(self, symbol, date, days=30):
        """获取情绪趋势（30日平均）"""
        result = await self.conn.fetchrow("""
            SELECT AVG(score) as avg_score
            FROM sentiment_history
            WHERE symbol = $1
            AND created_at BETWEEN $2::date - INTERVAL '%s days' AND $2::date
        """ % days, symbol, date)

        return float(result['avg_score']) if result and result['avg_score'] else 0.0

    async def generate_signals(self, data):
        """生成交易信号（应用情绪过滤）"""
        # 先生成基准信号
        base_signals = super().generate_signals(data)

        # 应用情绪过滤
        filtered_signals = []
        symbol = data.get('symbol', 'UNKNOWN')

        for signal in base_signals:
            idx = signal['index']
            date = datetime.fromtimestamp(data['timestamp'][idx] / 1000)

            # 获取情绪数据
            sentiment = await self.get_sentiment_score(symbol, date)
            sentiment_trend = await self.get_sentiment_trend(symbol, date, 30)

            action = signal['action']
            reason = signal['reason']

            # 短线规则：情绪过滤
            if action == 'BUY':
                if sentiment < SENTIMENT_CONFIG['short']['sell_threshold']:
                    action = 'WAIT'
                    reason = f"{reason} | 情绪极度负面({sentiment})，等待改善"
                elif sentiment > SENTIMENT_CONFIG['short']['wait_threshold'] and signal.get('rsi', 0) > SENTIMENT_CONFIG['short']['rsi_overbought']:
                    action = 'WAIT'
                    reason = f"{reason} | 情绪过热({sentiment}) + RSI超买({signal.get('rsi', 0):.1f})，等待回调"

            # 持仓时，情绪极度负面触发卖出
            if action == 'HOLD' and sentiment < SENTIMENT_CONFIG['short']['sell_threshold']:
                action = 'SELL'
                reason = f"情绪极度负面({sentiment})，提前止损"

            # 长线规则：情绪趋势影响权重
            weight = 1.0
            if sentiment_trend < SENTIMENT_CONFIG['long']['trend_threshold']:
                weight = 1.0 - SENTIMENT_CONFIG['long']['weight_reduction']
                reason = f"{reason} | 情绪趋势负面({sentiment_trend:.1f})，降低权重{int(SENTIMENT_CONFIG['long']['weight_reduction'] * 100)}%"

            filtered_signals.append({
                **signal,
                'action': action,
                'reason': reason,
                'sentiment': sentiment,
                'sentiment_trend': sentiment_trend,
                'weight': weight
            })

        return filtered_signals


async def run_backtest_comparison():
    """运行回测对比"""

    print("=" * 60)
    print("情绪因子回测对比")
    print("=" * 60)
    print()

    conn = await asyncpg.connect(**DB_CONFIG)

    try:
        # 1. 选择测试股票（有足够情绪数据的股票）
        print("1. 选择测试股票...")
        stocks = await conn.fetch("""
            SELECT symbol, COUNT(*) as count
            FROM sentiment_history
            WHERE symbol != 'MARKET'
            GROUP BY symbol
            HAVING COUNT(*) >= 50
            ORDER BY count DESC
            LIMIT 5
        """)

        test_symbols = [row['symbol'] for row in stocks]
        print(f"   测试股票: {', '.join(test_symbols)}")
        print(f"   每只股票情绪记录数: {', '.join(str(row['count']) for row in stocks)}")
        print()

        # 2. 加载K线数据并回测
        print("2. 运行回测...")
        print()

        all_results = {
            'baseline': {'trades': 0, 'wins': 0, 'total_return': 0},
            'sentiment': {'trades': 0, 'wins': 0, 'total_return': 0}
        }

        data_loader = DataLoader()
        baseline_params = {
            'ma_short': 11,
            'ma_long': 30,
            'rsi_period': 14,
            'rsi_oversold': 30,
            'rsi_overbought': 70
        }

        for symbol in test_symbols:
            print(f"   处理 {symbol}...")

            # 加载K线数据
            data_path = f"../../data/klines/{symbol}.json"
            if not os.path.exists(data_path):
                print(f"     跳过: 无K线数据")
                continue

            with open(data_path, 'r') as f:
                raw_data = json.load(f)
                klines = raw_data.get('klines', raw_data)

            if not klines or len(klines) < 100:
                print(f"     跳过: K线数据不足 ({len(klines) if klines else 0}条)")
                continue

            # 转换数据格式
            data = data_loader.prepare_data(klines, symbol)

            # 3. 基准策略回测
            baseline_strategy = Strategy(baseline_params)
            baseline_engine = BacktestEngine(baseline_strategy)
            baseline_result = baseline_engine.run(data)

            # 4. 情绪增强策略回测
            sentiment_strategy = SentimentStrategy(baseline_params, conn)
            sentiment_engine = BacktestEngine(sentiment_strategy)
            sentiment_result = sentiment_engine.run(data)

            # 5. 汇总结果
            print(f"     基准策略: {baseline_result['trades']}笔交易, "
                  f"胜率{baseline_result['win_rate'] * 100:.1f}%, "
                  f"Sharpe {baseline_result['sharpe']:.2f}")
            print(f"     情绪策略: {sentiment_result['trades']}笔交易, "
                  f"胜率{sentiment_result['win_rate'] * 100:.1f}%, "
                  f"Sharpe {sentiment_result['sharpe']:.2f}")
            print()

            all_results['baseline']['trades'] += baseline_result['trades']
            all_results['baseline']['wins'] += int(baseline_result['trades'] * baseline_result['win_rate'])
            all_results['baseline']['total_return'] += baseline_result.get('total_return', 0)

            all_results['sentiment']['trades'] += sentiment_result['trades']
            all_results['sentiment']['wins'] += int(sentiment_result['trades'] * sentiment_result['win_rate'])
            all_results['sentiment']['total_return'] += sentiment_result.get('total_return', 0)

        # 6. 总结对比
        print()
        print("=" * 60)
        print("回测对比总结")
        print("=" * 60)
        print()

        baseline_win_rate = (all_results['baseline']['wins'] / all_results['baseline']['trades'] * 100) if all_results['baseline']['trades'] > 0 else 0
        sentiment_win_rate = (all_results['sentiment']['wins'] / all_results['sentiment']['trades'] * 100) if all_results['sentiment']['trades'] > 0 else 0

        print("基准策略（纯技术指标）:")
        print(f"  总交易次数: {all_results['baseline']['trades']}")
        print(f"  胜率: {baseline_win_rate:.1f}%")
        print(f"  总收益: {all_results['baseline']['total_return'] * 100:.2f}%")
        print()

        print("情绪增强策略（技术指标 + 情绪因子）:")
        print(f"  总交易次数: {all_results['sentiment']['trades']}")
        print(f"  胜率: {sentiment_win_rate:.1f}%")
        print(f"  总收益: {all_results['sentiment']['total_return'] * 100:.2f}%")
        print()

        win_rate_diff = sentiment_win_rate - baseline_win_rate
        return_diff = (all_results['sentiment']['total_return'] - all_results['baseline']['total_return']) * 100

        print("改进效果:")
        print(f"  胜率变化: {'+' if win_rate_diff > 0 else ''}{win_rate_diff:.1f}%")
        print(f"  收益变化: {'+' if return_diff > 0 else ''}{return_diff:.2f}%")
        print()

        # 7. 结论
        print("结论:")
        if win_rate_diff >= 2 or return_diff >= 5:
            print("  ✅ 情绪因子显著改善策略表现，建议启用")
        elif win_rate_diff >= 0 and return_diff >= 0:
            print("  ⚠️  情绪因子略有改善，可以启用但需持续观察")
        else:
            print("  ❌ 情绪因子未改善策略表现，暂不建议启用")
        print()

        print("=" * 60)

    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(run_backtest_comparison())
