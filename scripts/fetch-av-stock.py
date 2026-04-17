#!/usr/bin/env python3
"""
用Alpha Vantage获取美股数据
API: d14oo91r01qop9mej190d14oo91r01qop9mej19g
免费版: 5次/分钟, 500次/天
"""

import os
import json
import time
import requests

API_KEY = 'NWR024T16AJIUMX6'
DATA_DIR = '/Users/zhengzefeng/.openclaw/workspace/MarketPlayer/data/cache/klines'

# 50只美股
US_STOCKS = [
    'AAPL','MSFT','GOOGL','AMZN','META','NVDA','TSLA','AVGO','ORCL','COST',
    'HD','MRK','LLY','JPM','UNH','V','MA','JNJ','WMT','PG','ABBV','ACN',
    'ADBE','CRM','NFLX','AMD','INTC','QCOM','TXN','AMAT','MU','NOW','SNOW',
    'UBER','ABNB','SHOP','COIN','MSTR','PLTR','NET','DDOG','CRWD','ZS',
    'PANW','FTNT','TEAM','DOCU','ZM','ROKU','BRK-B'
]

def get_daily_data(symbol):
    """获取每日K线数据"""
    url = f'https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol={symbol}&apikey={API_KEY}'
    
    try:
        resp = requests.get(url, timeout=15)
        data = resp.json()
        
        if 'Time Series (Daily)' in data:
            ts = data['Time Series (Daily)']
            klines = []
            
            for date, vals in ts.items():
                klines.append({
                    'date': date,
                    'open': float(vals['1. open']),
                    'high': float(vals['2. high']),
                    'low': float(vals['3. low']),
                    'close': float(vals['4. close']),
                    'volume': int(vals['5. volume'])
                })
            
            return klines[:500]  # 最近500天
        else:
            print(f"❌ {symbol}: {data.get('Note', data.get('Error Message', 'unknown'))}")
            return None
            
    except Exception as e:
        print(f"❌ {symbol}: {e}")
        return None

def main():
    print("=== 用Alpha Vantage获取美股数据 ===\n")
    
    success = 0
    for i, sym in enumerate(US_STOCKS):
        print(f"[{i+1}/{len(US_STOCKS)}] 获取 {sym}...", end=" ")
        
        data = get_daily_data(sym)
        
        if data:
            filepath = f"{DATA_DIR}/us_{sym}.json"
            with open(filepath, 'w') as f:
                json.dump(data, f, indent=2)
            print(f"✅ {len(data)}条")
            success += 1
        else:
            print("❌")
        
        # 限流: 免费版5次/分钟
        if (i + 1) % 5 == 0:
            print("⏳ 等待60秒 (API限流)...")
            time.sleep(60)
        else:
            time.sleep(1)
    
    print(f"\n=== 完成: {success}/{len(US_STOCKS)} ===")

if __name__ == '__main__':
    main()
