"""
测试情绪分析算法，找出为什么所有结果都是 neutral
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sentiment import analyze_sentiment, POSITIVE_WORDS, NEGATIVE_WORDS
import asyncpg
import asyncio


async def debug_sentiment():
    """调试情绪分析"""

    print("=" * 60)
    print("情绪分析调试")
    print("=" * 60)
    print()

    # 连接数据库
    conn = await asyncpg.connect(
        host="localhost",
        port=5432,
        database="trading_bot",
        user="zhengzefeng",
        password="password"
    )

    try:
        # 1. 读取样本新闻
        print("1. 读取样本新闻（最近10条）...")
        news_items = await conn.fetch("""
            SELECT title, content, source
            FROM news_items
            ORDER BY published_at DESC
            LIMIT 10
        """)

        print(f"   找到 {len(news_items)} 条新闻\n")

        # 2. 逐条分析
        print("2. 逐条分析情绪...")
        print()

        for i, news in enumerate(news_items):
            title = news['title'] or ''
            content = news['content'] or ''
            text = f"{title} {content}"

            # 分析情绪
            sentiment = analyze_sentiment(text)

            # 统计关键词匹配
            text_lower = text.lower()
            pos_matches = [w for w in POSITIVE_WORDS if w.lower() in text_lower]
            neg_matches = [w for w in NEGATIVE_WORDS if w.lower() in text_lower]

            print(f"[{i+1}] 来源: {news['source']}")
            print(f"    标题: {title[:80]}")
            print(f"    内容: {content[:100] if content else '(无内容)'}")
            print(f"    情绪: {sentiment}")
            print(f"    正面词匹配: {len(pos_matches)} 个 - {pos_matches[:5]}")
            print(f"    负面词匹配: {len(neg_matches)} 个 - {neg_matches[:5]}")
            print()

        # 3. 统计整体情况
        print("3. 统计整体情况...")

        all_news = await conn.fetch("""
            SELECT title, content
            FROM news_items
            LIMIT 100
        """)

        sentiments = {"positive": 0, "negative": 0, "neutral": 0}
        total_pos_matches = 0
        total_neg_matches = 0

        for news in all_news:
            text = f"{news['title'] or ''} {news['content'] or ''}"
            sentiment = analyze_sentiment(text)
            sentiments[sentiment] += 1

            text_lower = text.lower()
            pos_matches = sum(1 for w in POSITIVE_WORDS if w.lower() in text_lower)
            neg_matches = sum(1 for w in NEGATIVE_WORDS if w.lower() in text_lower)
            total_pos_matches += pos_matches
            total_neg_matches += neg_matches

        print(f"   样本数: {len(all_news)}")
        print(f"   情绪分布:")
        for sentiment, count in sentiments.items():
            percentage = count * 100 / len(all_news)
            print(f"     {sentiment}: {count} ({percentage:.1f}%)")
        print()
        print(f"   平均每条新闻:")
        print(f"     正面词匹配: {total_pos_matches / len(all_news):.2f} 个")
        print(f"     负面词匹配: {total_neg_matches / len(all_news):.2f} 个")
        print()

        # 4. 测试已知情绪的文本
        print("4. 测试已知情绪的文本...")
        test_cases = [
            ("苹果股价飙升创新高，盈利超预期", "positive"),
            ("美联储警告经济风险，市场暴跌", "negative"),
            ("市场震荡，投资者观望", "neutral"),
            ("Apple stock surges to new high, profit beats expectations", "positive"),
            ("Fed warns of economic risks, market crashes", "negative"),
            ("Market flat, investors hold", "neutral"),
        ]

        for text, expected in test_cases:
            result = analyze_sentiment(text)
            status = "✅" if result == expected else "❌"
            print(f"   {status} '{text}' -> {result} (预期: {expected})")

        print()

    finally:
        await conn.close()

    print("=" * 60)
    print("调试完成")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(debug_sentiment())
