#!/usr/bin/env python3
"""
新闻推送触发器
每5分钟调用 /api/news/fetch，获取新新闻后推送给前端
"""

import os
import sys
import json
import time
import asyncio
import httpx
from datetime import datetime, timedelta

# WebSocket 推送
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
try:
    from sockets.news_socket import emitNews, emitNewsBatch
    WS_ENABLED = True
except ImportError:
    WS_ENABLED = False
    print("[news-push] WebSocket 模块未找到，跳过推送")


FETCH_INTERVAL = 300  # 5分钟
FETCH_URL = os.getenv("NEWS_API_URL", "http://localhost:8000")


async def fetch_and_push():
    """拉取新闻并推送"""
    print(f"[news-push] {datetime.now().isoformat()} 开始拉取新闻...")
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            # 1. 抓取新新闻
            resp = await client.post(f"{FETCH_URL}/api/news/fetch", params={"limit_per_source": 10})
            if resp.status_code != 200:
                print(f"[news-push] 抓取失败: {resp.status_code}")
                return
            
            fetch_result = resp.json()
            stats = fetch_result.get("stats", {})
            saved = stats.get("saved", 0)
            print(f"[news-push] 抓取完成: 新增 {saved} 条")
            
            # 2. 获取最新新闻列表
            if saved > 0:
                resp = await client.get(f"{FETCH_URL}/api/news", params={"limit": saved, "source": "fetch"})
                if resp.status_code == 200:
                    news_list = resp.json().get("data", [])
                    
                    # 3. 推送 WebSocket
                    if WS_ENABLED and news_list:
                        try:
                            emitNewsBatch(news_list)
                            print(f"[news-push] 已推送 {len(news_list)} 条新闻")
                        except Exception as e:
                            print(f"[news-push] 推送失败: {e}")
            
        except Exception as e:
            print(f"[news-push] 错误: {e}")


async def main():
    """主循环"""
    print(f"[news-push] 启动，每 {FETCH_INTERVAL}s 抓取一次")
    
    while True:
        try:
            await fetch_and_push()
        except Exception as e:
            print(f"[news-push] 循环错误: {e}")
        
        await asyncio.sleep(FETCH_INTERVAL)


if __name__ == "__main__":
    asyncio.run(main())