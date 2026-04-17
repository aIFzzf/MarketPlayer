#!/usr/bin/env python3
"""
全量K线数据更新脚本
从watchlist表读取所有股票，更新K线数据
"""

import sqlite3
import requests
import json
import time
import os
from datetime import datetime

DATA_DIR = '/Users/zhengzefeng/.openclaw/workspace/MarketPlayer/data/cache/klines'
DB = '/Users/zhengzefeng/.openclaw/workspace/MarketPlayer/watchlist.db'

def get_watchlist():
    """从数据库获取所有股票"""
    conn = sqlite3.connect(DB)
    cursor = conn.cursor()
    cursor.execute('''
        SELECT symbol, name, market 
        FROM watchlist 
        WHERE is_active = 1 
        ORDER BY market, symbol
    ''')
    stocks = cursor.fetchall()
    conn.close()
    return stocks

def get_us_kline(symbol):
    """获取美股K线"""
    try:
        url = f'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=2y&interval=1d'
        resp = requests.get(url, timeout=15)
        data = resp.json()
        
        result = data.get('chart', {}).get('result')
        if not result:
            return None
        
        ts_data = result[0].get('timestamp', [])
        quotes = result[0].get('indicators', {}).get('quote', [{}])[0]
        
        if not ts_data:
            return None
        
        klines = []
        for i, ts in enumerate(ts_data):
            klines.append({
                'date': datetime.fromtimestamp(ts).strftime('%Y-%m-%d'),
                'open': quotes['open'][i],
                'high': quotes['high'][i],
                'low': quotes['low'][i],
                'close': quotes['close'][i],
                'volume': quotes['volume'][i]
            })
        
        return {
            'symbol': symbol,
            'market': 'us',
            'klines': klines,
            'updated_at': datetime.now().isoformat()
        }
    except Exception as e:
        return None

def get_hk_quote(code):
    """获取港股实时行情"""
    try:
        url = f'https://qt.gtimg.cn/q=hk{code}'
        resp = requests.get(url, timeout=10)
        text = resp.content.decode('gbk', errors='ignore')
        
        import re
        match = re.search(rf'v_hk\d+="([^"]+)"', text)
        if not match:
            return None
        
        fields = match.group(1).split('~')
        return {
            'symbol': code,
            'market': 'hk',
            'name': fields[1],
            'price': float(fields[3]) if fields[3] else None,
            'change': float(fields[31]) if fields[31] else None,
            'change_pct': float(fields[32]) if fields[32] else None,
            'volume': int(float(fields[6])) if fields[6] else 0,
            'updated_at': datetime.now().isoformat()
        }
    except Exception as e:
        return None

def save_kline(data, market):
    """保存K线数据"""
    if not data:
        return False
    
    symbol = data['symbol']
    filename = f"{market}_{symbol}.json"
    filepath = os.path.join(DATA_DIR, filename)
    
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    return True

def main():
    print("=" * 60)
    print("全量K线数据更新")
    print("=" * 60)
    
    stocks = get_watchlist()
    print(f"总股票数: {len(stocks)}")
    
    # 统计
    stats = {'us': {'success': 0, 'fail': 0}, 'hk': {'success': 0, 'fail': 0}, 'cn': {'success': 0, 'fail': 0}}
    
    for i, (symbol, name, market) in enumerate(stocks):
        print(f"[{i+1}/{len(stocks)}] {market}/{symbol}...", end=' ')
        
        if market == 'us':
            data = get_us_kline(symbol)
            if data and save_kline(data, 'us'):
                print(f"✅ {len(data.get('klines', []))}条")
                stats['us']['success'] += 1
            else:
                print("❌")
                stats['us']['fail'] += 1
            time.sleep(0.5)  # 避免限流
        
        elif market == 'hk':
            data = get_hk_quote(symbol)
            if data and save_kline(data, 'hk'):
                print(f"✅ P={data.get('price')}")
                stats['hk']['success'] += 1
            else:
                print("❌")
                stats['hk']['fail'] += 1
            time.sleep(0.5)
        
        else:
            # A股跳过
            print("⏭️ 跳过")
            stats['cn']['success'] += 1
        
        # 每50个输出进度
        if (i + 1) % 50 == 0:
            print(f"\n进度: {i+1}/{len(stocks)}")
    
    # 最终统计
    print("\n" + "=" * 60)
    print("更新完成统计")
    print("=" * 60)
    
    total_success = sum(s['success'] for s in stats.values())
    total_fail = sum(s['fail'] for s in stats.values())
    
    for m, s in stats.items():
        print(f"{m}: 成功={s['success']}, 失败={s['fail']}")
    
    print(f"\n总计: 成功={total_success}, 失败={total_fail}")
    
    # 检查时间戳
    print("\n=== 最新数据时间戳 ===")
    today = datetime.now().strftime('%Y-%m-%d')
    
    for market, prefix in [('us', 'us_AAPL'), ('hk', 'hk_00700')]:
        fpath = os.path.join(DATA_DIR, f"{prefix}.json")
        if os.path.exists(fpath):
            with open(fpath) as f:
                data = json.load(f)
                updated = data.get('updated_at', '')[:10]
                print(f"{market}: {updated} {'✅' if updated == today else '❌'}")

if __name__ == '__main__':
    main()