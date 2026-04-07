#!/usr/bin/env python3
"""
新闻推送触发器（简化版）
每5分钟调用 /api/news/fetch，获取新新闻后通过 HTTP 通知主服务器
"""

import os
import json
import time
import asyncio
import httpx
from datetime import datetime

FETCH_INTERVAL = 300  # 5分钟
NEWS_API_URL = "http://localhost:8000"
MAIN_API_URL = "http://localhost:3000"


async def fetch_and_notify():
    """拉取新闻并通知主服务器"""
    print(f"[news-push] {datetime.now().isoformat()} 开始拉取新闻...")

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            # 1. 抓取新新闻
            resp = await client.post(f"{NEWS_API_URL}/api/news/fetch", params={"limit_per_source": 10})
            if resp.status_code != 200:
                print(f"[news-push] 抓取失败: {resp.status_code}")
                return

            fetch_result = resp.json()
            stats = fetch_result.get("stats", {})
            saved = stats.get("saved", 0)
            print(f"[news-push] 抓取完成: 新增 {saved} 条")

            # 2. 获取最新新闻列表
            if saved > 0:
                resp = await client.get(f"{NEWS_API_URL}/api/news", params={"limit": saved})
                if resp.status_code == 200:
                    news_list = resp.json().get("data", [])
                    print(f"[news-push] 获取到 {len(news_list)} 条新闻")

                    # 3. 通知主服务器（可选，如果主服务器有 WebSocket 推送端点）
                    # 这里暂时只打印，实际可以调用主服务器的推送 API
                    for news in news_list[:3]:  # 只打印前3条
                        print(f"  - {news.get('title', '')[:50]}...")

        except Exception as e:
            print(f"[news-push] 错误: {e}")


async def main():
    """主循环"""
    print(f"[news-push] 启动，每 {FETCH_INTERVAL}s 抓取一次")
    print(f"[news-push] 新闻 API: {NEWS_API_URL}")

    while True:
        try:
            await fetch_and_notify()
        except Exception as e:
            print(f"[news-push] 循环错误: {e}")

        print(f"[news-push] 等待 {FETCH_INTERVAL}s...")
        await asyncio.sleep(FETCH_INTERVAL)


if __name__ == "__main__":
    asyncio.run(main())
