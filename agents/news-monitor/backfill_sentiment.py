"""
历史情绪数据回填脚本
从 news_items 表读取所有新闻，分析情绪并写入 sentiment_history 表
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sentiment import analyze_sentiment
import asyncpg
import asyncio
from datetime import datetime

# 数据库配置
DB_CONFIG = {
    "host": "localhost",
    "port": 5432,
    "database": "trading_bot",
    "user": "zhengzefeng",
    "password": "password",
}


def sentiment_to_score(sentiment: str) -> int:
    """
    将情绪标签转换为分数

    Args:
        sentiment: positive/negative/neutral

    Returns:
        分数 (-100 到 +100)
    """
    mapping = {
        'positive': 50,
        'negative': -50,
        'neutral': 0,
    }
    return mapping.get(sentiment, 0)


async def backfill_sentiment_data():
    """回填历史情绪数据"""

    print("=" * 60)
    print("历史情绪数据回填")
    print("=" * 60)
    print()

    # 连接数据库
    conn = await asyncpg.connect(**DB_CONFIG)

    try:
        # 1. 读取所有新闻
        print("1. 读取历史新闻...")
        news_items = await conn.fetch("""
            SELECT id, title, content, symbols, published_at, created_at
            FROM news_items
            ORDER BY published_at DESC
        """)

        print(f"   找到 {len(news_items)} 条新闻")
        print()

        # 2. 分析情绪并写入
        print("2. 分析情绪并写入 sentiment_history...")

        success_count = 0
        error_count = 0
        skip_count = 0

        for i, news in enumerate(news_items):
            try:
                # 合并标题和内容
                text = f"{news['title'] or ''} {news['content'] or ''}"

                # 分析情绪
                sentiment = analyze_sentiment(text)
                score = sentiment_to_score(sentiment)

                # 解析股票列表
                symbols = news['symbols']
                if isinstance(symbols, str):
                    symbol_list = [s.strip() for s in symbols.split(',') if s.strip()]
                elif isinstance(symbols, list):
                    symbol_list = symbols
                else:
                    symbol_list = []

                # 如果没有明确股票，使用 'MARKET' 作为市场整体情绪
                if not symbol_list:
                    symbol_list = ['MARKET']

                # 为每个股票写入情绪记录
                for symbol in symbol_list:
                    try:
                        # 处理时区问题
                        timestamp = news['published_at'] or news['created_at']
                        if timestamp and hasattr(timestamp, 'replace'):
                            # 移除时区信息
                            timestamp = timestamp.replace(tzinfo=None)

                        await conn.execute("""
                            INSERT INTO sentiment_history (symbol, score, count, positive, negative, neutral, created_at)
                            VALUES ($1, $2, 1, $3, $4, $5, $6)
                        """,
                            symbol,
                            score,
                            1 if sentiment == 'positive' else 0,
                            1 if sentiment == 'negative' else 0,
                            1 if sentiment == 'neutral' else 0,
                            timestamp
                        )
                        success_count += 1
                    except Exception as e:
                        error_count += 1
                        if error_count <= 3:  # 显示前3个错误详情
                            print(f"   错误详情: {e}")
                            print(f"   数据: symbol={symbol}, score={score}, date={timestamp}")

                # 进度显示
                if (i + 1) % 100 == 0:
                    print(f"   处理进度: {i + 1}/{len(news_items)} ({(i+1)*100//len(news_items)}%)")

            except Exception as e:
                error_count += 1
                if error_count <= 5:  # 只显示前5个错误
                    print(f"   错误: {e}")

        print()
        print(f"   处理完成: {len(news_items)} 条新闻")
        print(f"   成功写入: {success_count} 条情绪记录")
        print(f"   跳过重复: {skip_count} 条")
        print(f"   错误: {error_count} 条")
        print()

        # 3. 统计结果
        print("3. 统计回填结果...")

        # 总记录数
        total = await conn.fetchval("SELECT COUNT(*) FROM sentiment_history")
        print(f"   总记录数: {total}")

        # 覆盖股票数
        symbols_count = await conn.fetchval("SELECT COUNT(DISTINCT symbol) FROM sentiment_history")
        print(f"   覆盖股票: {symbols_count}")

        # 时间范围
        time_range = await conn.fetchrow("""
            SELECT MIN(created_at) as earliest, MAX(created_at) as latest
            FROM sentiment_history
        """)
        print(f"   时间范围: {time_range['earliest']} 到 {time_range['latest']}")

        # 情绪分布
        distribution = await conn.fetch("""
            SELECT
                CASE
                    WHEN score > 50 THEN 'positive'
                    WHEN score < -50 THEN 'negative'
                    ELSE 'neutral'
                END as sentiment_type,
                COUNT(*) as count
            FROM sentiment_history
            GROUP BY sentiment_type
            ORDER BY count DESC
        """)

        print()
        print("   情绪分布:")
        for row in distribution:
            percentage = row['count'] * 100 / total
            print(f"     {row['sentiment_type']}: {row['count']} ({percentage:.1f}%)")

        print()
        print("=" * 60)
        print("回填完成！")
        print("=" * 60)

    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(backfill_sentiment_data())
