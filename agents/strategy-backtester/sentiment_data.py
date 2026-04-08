"""
情绪数据准备模块
从 sentiment_history 表读取历史情绪数据
"""

import asyncpg
import os
from datetime import datetime, timedelta
from typing import Dict, Optional


class SentimentDataProvider:
    """情绪数据提供者"""

    def __init__(self):
        self.db_config = {
            "host": os.getenv("PGHOST", "localhost"),
            "port": int(os.getenv("PGPORT", "5432")),
            "database": os.getenv("DATABASE", "trading_bot"),
            "user": os.getenv("PGUSER", "zhengzefeng"),
            "password": os.getenv("PGPASSWORD", "password"),
        }
        self.cache = {}

    async def get_sentiment_score(self, symbol: str, date: datetime) -> int:
        """
        获取指定股票在指定日期的情绪分数

        Args:
            symbol: 股票代码
            date: 日期

        Returns:
            情绪分数 (-100 到 +100)，如果没有数据返回 0
        """
        # 检查缓存
        cache_key = f"{symbol}_{date.strftime('%Y-%m-%d')}"
        if cache_key in self.cache:
            return self.cache[cache_key]

        # 从数据库查询
        conn = await asyncpg.connect(**self.db_config)
        try:
            # 查询当天的情绪数据
            result = await conn.fetchrow("""
                SELECT score
                FROM sentiment_history
                WHERE symbol = $1
                AND DATE(created_at) = DATE($2)
                ORDER BY created_at DESC
                LIMIT 1
            """, symbol, date)

            score = result['score'] if result else 0
            self.cache[cache_key] = score
            return score
        finally:
            await conn.close()

    async def get_sentiment_trend(self, symbol: str, date: datetime, days: int = 30) -> float:
        """
        获取指定股票的情绪趋势（过去N天的平均情绪）

        Args:
            symbol: 股票代码
            date: 截止日期
            days: 回溯天数

        Returns:
            平均情绪分数
        """
        conn = await asyncpg.connect(**self.db_config)
        try:
            start_date = date - timedelta(days=days)
            result = await conn.fetchrow("""
                SELECT AVG(score) as avg_score
                FROM sentiment_history
                WHERE symbol = $1
                AND created_at BETWEEN $2 AND $3
            """, symbol, start_date, date)

            return float(result['avg_score']) if result and result['avg_score'] else 0.0
        finally:
            await conn.close()


# 同步版本（用于向量化回测）
def get_sentiment_score_sync(symbol: str, date_str: str) -> int:
    """
    同步版本的情绪分数获取（用于回测）

    Args:
        symbol: 股票代码
        date_str: 日期字符串 'YYYY-MM-DD'

    Returns:
        情绪分数 (-100 到 +100)
    """
    import psycopg2

    conn = psycopg2.connect(
        host="localhost",
        port=5432,
        database="trading_bot",
        user="zhengzefeng",
        password="password"
    )

    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT score
            FROM sentiment_history
            WHERE symbol = %s
            AND DATE(created_at) = DATE(%s)
            ORDER BY created_at DESC
            LIMIT 1
        """, (symbol, date_str))

        result = cursor.fetchone()
        return result[0] if result else 0
    finally:
        conn.close()


if __name__ == "__main__":
    # 测试
    import asyncio

    async def test():
        provider = SentimentDataProvider()

        # 测试获取情绪分数
        score = await provider.get_sentiment_score("AAPL", datetime.now())
        print(f"AAPL 今日情绪分数: {score}")

        # 测试获取情绪趋势
        trend = await provider.get_sentiment_trend("AAPL", datetime.now(), 30)
        print(f"AAPL 30日情绪趋势: {trend:.2f}")

    asyncio.run(test())
