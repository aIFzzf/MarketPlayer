"""
FastAPI 主服务 - 新闻监控系统
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import asyncpg
import os
import asyncio
import httpx
from datetime import datetime

# 情绪分析模块
from sentiment import analyze_sentiment

app = FastAPI(title="MarketPlayer News Monitor")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 数据库配置
DB_CONFIG = {
    "host": os.getenv("PGHOST", "localhost"),
    "port": int(os.getenv("PGPORT", "5432")),
    "database": os.getenv("DATABASE", "trading_bot"),
    "user": os.getenv("PGUSER", "zhengzefeng"),
    "password": os.getenv("PGPASSWORD", "password"),
}
db_pool = None


@app.on_event("startup")
async def startup():
    global db_pool
    db_pool = await asyncpg.create_pool(**DB_CONFIG)


@app.on_event("shutdown")
async def shutdown():
    await db_pool.close()


@app.get("/")
async def root():
    return {"status": "ok", "service": "news-monitor"}


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/api/news")
async def get_news(
    limit: int = 50, 
    offset: int = 0,
    source: str = None,
    market: str = None,
    start_date: str = None,
    end_date: str = None,
    search: str = None,
):
    """
    获取新闻列表
    
    Query Parameters:
    - limit: 返回条数 (默认50)
    - offset: 偏移量 (默认0)
    - source: 数据源筛选 (eastmoney/gdelt/xueqiu)
    - market: 市场筛选 (cn/us/global)
    - start_date: 开始日期 (ISO格式)
    - end_date: 结束日期 (ISO格式)
    - search: 关键词搜索
    """
    # 构建查询 (不包含 sentiment 列，因为该列可能不存在)
    query = "SELECT id, title, content, url, source, published_at, market, created_at FROM news_items WHERE 1=1"
    params = []
    
    if source:
        query += " AND source = $" + str(len(params) + 1)
        params.append(source)
    
    if market:
        query += " AND market = $" + str(len(params) + 1)
        params.append(market)
    
    if start_date:
        query += " AND published_at >= $" + str(len(params) + 1)
        params.append(start_date)
    
    if end_date:
        query += " AND published_at <= $" + str(len(params) + 1)
        params.append(end_date)
    
    if search:
        query += " AND (title ILIKE $" + str(len(params) + 1) + " OR content ILIKE $" + str(len(params) + 2) + ")"
        search_pattern = f"%{search}%"
        params.extend([search_pattern, search_pattern])
    
    # 总数查询
    count_query = query.replace("SELECT id, title, content, url, source, published_at, market, created_at", "SELECT COUNT(*)")
    
    # 添加排序和分页
    query += " ORDER BY published_at DESC LIMIT $" + str(len(params) + 1) + " OFFSET $" + str(len(params) + 2)
    params.extend([limit, offset])
    
    async with db_pool.acquire() as conn:
        # 获取总数 (使用原始params)
        total_params = params[:-2] if params else []
        total = await conn.fetchval(count_query, *total_params) if total_params else await conn.fetchval(count_query)
        
        # 获取列表
        rows = await conn.fetch(query, *params)
        
        return {
            "success": True,
            "data": [dict(row) for row in rows],
            "pagination": {
                "total": total,
                "limit": limit,
                "offset": offset,
                "has_more": offset + len(rows) < total
            }
        }


@app.post("/api/news/fetch")
async def fetch_news(limit_per_source: int = 10):
    """抓取新闻并写入数据库"""
    stats = {
        "total_fetched": 0,
        "by_source": {},
        "errors": [],
        "saved": 0
    }
    
    async def fetch_eastmoney():
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                url = "https://stockapi.eastmoney.com/EM-XuhanG-Api/rest/publicpolic/99"
                resp = await client.get(url, params={"client": "pc", "page": "1", "size": str(limit_per_source)})
                if resp.status_code == 200:
                    data = resp.json()
                    items = []
                    for art in data.get("LivesList", [])[:limit_per_source]:
                        items.append({
                            "title": art.get("title", ""),
                            "content": art.get("content", ""),
                            "url": art.get("url", ""),
                            "source": "eastmoney",
                            "published_at": datetime.now(),
                            "market": "cn",
                        })
                    return {"source": "eastmoney", "items": items}
                return {"source": "eastmoney", "items": []}
        except Exception as e:
            return {"source": "eastmoney", "items": [], "error": str(e)}

    async def fetch_gdelt():
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                url = "https://api.gdelt.net/v4"
                resp = await client.get(url, params={"mode": "artlist", "maxrec": str(limit_per_source)})
                if resp.status_code == 200:
                    data = resp.json()
                    items = []
                    for art in data.get("articles", [])[:limit_per_source]:
                        items.append({
                            "title": art.get("title", ""),
                            "content": art.get("seentitle", ""),
                            "url": art.get("url", ""),
                            "source": "gdelt",
                            "published_at": datetime.now(),
                            "market": "global",
                        })
                    return {"source": "gdelt", "items": items}
                return {"source": "gdelt", "items": []}
        except Exception as e:
            return {"source": "gdelt", "items": [], "error": str(e)}

    async def fetch_xueqiu():
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                url = "https://stock.xueqiu.com/v5/stock/board/listingidea/robot.json"
                resp = await client.get(url, params={"page": "1", "size": str(limit_per_source)}, headers={"User-Agent": "Mozilla/5.0"})
                if resp.status_code == 200:
                    data = resp.json()
                    items = []
                    for art in data.get("items", [])[:limit_per_source]:
                        items.append({
                            "title": art.get("title", ""),
                            "content": art.get("text", ""),
                            "url": f"https://xueqiu.com/a/{art.get('id')}",
                            "source": "xueqiu",
                            "published_at": datetime.now(),
                            "market": "cn",
                        })
                    return {"source": "xueqiu", "items": items}
                return {"source": "xueqiu", "items": []}
        except Exception as e:
            return {"source": "xueqiu", "items": [], "error": str(e)}

    # 执行抓取
    results = await asyncio.gather(
        fetch_eastmoney(),
        fetch_gdelt(),
        fetch_xueqiu(),
        return_exceptions=True
    )
    
    # 处理结果
    all_news = []
    for result in results:
        if isinstance(result, Exception):
            stats["errors"].append(str(result))
            continue
        
        source = result.get("source")
        items = result.get("items", [])
        error = result.get("error")
        
        if error:
            stats["errors"].append(f"{source}: {error}")
        else:
            stats["by_source"][source] = len(items)
            stats["total_fetched"] += len(items)
            all_news.extend(items)
    
    # 写入数据库
    if all_news:
        inserted = await _save_news(all_news)
        stats["saved"] = inserted
    
    return {"success": True, "stats": stats}


async def _save_news(news_items):
    """写入新闻到数据库，包含情绪分析"""
    inserted = 0
    
    async with db_pool.acquire() as conn:
        for news in news_items:
            try:
                title_hash = hash(news['title'] + news['source'])
                news_id = f"news_{abs(title_hash)}"[:20]
                
                # 检查重复
                exists = await conn.fetchval(
                    "SELECT 1 FROM news_items WHERE title = $1 AND source = $2",
                    news["title"], news["source"]
                )
                if exists:
                    continue
                
                # 情绪分析
                text = f"{news.get('title', '')} {news.get('content', '')}"
                sentiment = analyze_sentiment(text)
                
                # 写入
                await conn.execute(
                    """
                    INSERT INTO news_items 
                    (id, title, content, url, source, published_at, market, sentiment, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                    """,
                    news_id,
                    news["title"],
                    news.get("content", ""),
                    news.get("url", ""),
                    news["source"],
                    news.get("published_at"),
                    news.get("market", "global"),
                    sentiment,
                )
                inserted += 1
            except Exception:
                pass
    
    return inserted


@app.get("/api/news/stats")
async def get_stats():
    """统计"""
    async with db_pool.acquire() as conn:
        total = await conn.fetchval('SELECT COUNT(*) FROM news_items')
        return {"success": True, "data": {"total": total}}


@app.get("/api/anomalies")
async def get_anomalies(
    limit: int = 50, 
    offset: int = 0,
    detector_type: str = None,
    severity: str = None
):
    """查询历史异常"""
    conditions = []
    params = []
    
    if detector_type:
        conditions.append(f"detector_type = ${len(params) + 1}")
        params.append(detector_type)
    
    if severity:
        conditions.append(f"severity = ${len(params) + 1}")
        params.append(severity)
    
    where_clause = " AND ".join(conditions) if conditions else "1=1"
    
    async with db_pool.acquire() as conn:
        # 总数
        total = await conn.fetchval(f"SELECT COUNT(*) FROM anomaly_log WHERE {where_clause}", *params)
        
        # 列表
        query = f"SELECT * FROM anomaly_log WHERE {where_clause} ORDER BY detected_at DESC LIMIT ${len(params) + 1} OFFSET ${len(params) + 2}"
        params.extend([limit, offset])
        
        rows = await conn.fetch(query, *params)
        
        return {
            "success": True,
            "data": [dict(row) for row in rows],
            "pagination": {
                "total": total,
                "limit": limit,
                "offset": offset
            }
        }


# ========== 因子 API ==========

@app.get("/api/factors/{symbol}")
async def get_symbol_factors(symbol: str):
    """查询单股票因子"""
    import subprocess
    
    try:
        result = subprocess.run(
            ['python3', '-c', f'''
import sys
sys.path.insert(0, '.')
from src.factors.calculator import calculate_all_factors
r = calculate_all_factors('{symbol}')
import json, sys
if r:
    print(json.dumps(r))
else:
    print('null')
'''],
            capture_output=True,
            text=True,
            cwd=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
            timeout=30
        )
        
        if result.returncode != 0:
            return {"success": False, "error": result.stderr}
        
        if result.stdout.strip() == 'null' or not result.stdout.strip():
            return {"success": False, "error": "No data"}
        
        import json
        data = json.loads(result.stdout.strip())
        return {"success": True, "data": data}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.get("/api/factors/batch")
async def get_batch_factors(symbols: str):
    """批量查询因子 (逗号分隔)"""
    import subprocess
    
    symbol_list = [s.strip() for s in symbols.split(",")]
    
    try:
        result = subprocess.run(
            ['python3', '-c', f'''
import sys
sys.path.insert(0, '.')
from src.factors.calculator import calculate_batch_factors
results = calculate_batch_factors({symbol_list})
import json, sys
print(json.dumps(results))
'''],
            capture_output=True,
            text=True,
            cwd=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
            timeout=60
        )
        
        if result.returncode != 0:
            return {"success": False, "error": result.stderr}
        
        import json
        data = json.loads(result.stdout.strip()) if result.stdout.strip() else []
        return {"success": True, "count": len(data), "data": data}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.get("/api/factors/batch")
async def get_batch_factors(symbols: str):
    """批量查询因子 (逗号分隔)"""
    symbol_list = [s.strip() for s in symbols.split(",")]
    
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    
    try:
        from src.factors.calculator import calculateBatchFactors
        results = calculateBatchFactors(symbol_list)
        
        return {"success": True, "count": len(results), "data": results}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.get("/api/factors/test/{factor_name}")
async def get_factor_test(factor_name: str):
    """查询因子测试结果"""
    async with db_pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT * FROM factor_performance 
            WHERE factor_name = $1
            ORDER BY test_date DESC
            LIMIT 10
            """,
            factor_name
        )
        
        return {"success": True, "data": [dict(row) for row in rows]}


@app.post("/api/factors/calculate")
async def calculate_factors(symbols: str = None):
    """手动触发因子计算"""
    import subprocess
    
    symbol_list = symbols.split(",") if symbols else ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'TSLA']
    symbol_list = [s.strip() for s in symbol_list]
    
    try:
        result = subprocess.run(
            ['python3', 'src/factors/calculator.py'] + symbol_list,
            capture_output=True,
            text=True,
            cwd=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
            timeout=60
        )
        
        if result.returncode != 0:
            return {"success": False, "error": result.stderr}
        
        # 解析输出，提取因子值
        import re
        ic_matches = re.findall(r'(\w+):\s+([-\d.]+)', result.stdout)
        
        return {
            "success": True,
            "factor_count": len(symbol_list),
            "results": [{'factor': k, 'value': float(v)} for k, v in ic_matches[:10]]
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


# ========== 情绪 API ==========

@app.get("/api/sentiment/{symbol}")
async def get_symbol_sentiment(symbol: str):
    """查询股票情绪"""
    import subprocess
    try:
        result = subprocess.run(
            ['python3', 'src/sentiment/quantifier.py', symbol],
            capture_output=True, text=True, timeout=30,
            cwd=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
        
        import json
        if result.stdout.strip():
            data = json.loads(result.stdout.strip())
            return {"success": True, "data": data}
        
        return {"success": True, "data": {"score": 0, "count": 0}}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.get("/api/sentiment")
async def get_market_sentiment():
    """查询市场整体情绪"""
    import subprocess
    try:
        result = subprocess.run(
            ['python3', '-c', '''
import sys
sys.path.insert(0, ".")
from src.sentiment.quantifier import quantify_sentiment, calculate_momentum
import json
sent = quantify_sentiment()
mom = calculate_momentum()
result = {**sent, **mom}
print(json.dumps(result))
'''],
            capture_output=True, text=True, timeout=30,
            cwd=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
        
        import json
        if result.stdout.strip():
            data = json.loads(result.stdout.strip())
            return {"success": True, "data": data}
        
        return {"success": True, "data": {"score": 0, "count": 0, "trend": "stable"}}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.get("/api/sentiment/signals")
async def get_sentiment_signals():
    """查询情绪信号 (简化版，直接返回空)"""
    # 简化：暂不调用 TypeScript
    return {"success": True, "count": 0, "data": []}


@app.post("/api/sentiment/calculate")
async def calculate_sentiment():
    """手动触发情绪计算"""
    import subprocess
    try:
        # 运行 Python 版本
        result = subprocess.run(
            ['python3', 'src/sentiment/quantifier.py'],
            capture_output=True, text=True, timeout=30,
            cwd=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
        
        import json
        data = json.loads(result.stdout.strip()) if result.stdout.strip() else {}
        
        return {"success": True, "data": data}
    except Exception as e:
        return {"success": False, "error": str(e)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)