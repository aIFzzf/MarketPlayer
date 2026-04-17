#!/usr/bin/env python3
"""
分批K线数据更新脚本 (新调度策略 - 全部用 Twelve Data)
"""

import os, sys, json, time, argparse, requests

API_KEY_TD = '241820ae70274dc09e534c76eea0a160'
DATA_DIR = '/Users/zhengzefeng/.openclaw/workspace/MarketPlayer/data/cache/klines'
LOG_DIR = '/Users/zhengzefeng/.openclaw/workspace/MarketPlayer/logs'
INTERVAL = 15

US = ['AAPL','MSFT','GOOGL','AMZN','NVDA','TSLA','META','AVGO','ORCL','COST','HD','MRK','LLY','JPM','UNH','V','MA','JNJ','WMT','PG','ABBV','ACN','ADBE','CRM','NFLX','AMD','INTC','QCOM','TXN','AMAT','MU','NOW','SNOW','UBER','ABNB','SHOP','COIN','MSTR','PLTR','NET','DDOG','CRWD','ZS','PANW','FTNT','TEAM','DOCU','ZM','ROKU','BKNG','BLK','BMY','AXP','BA','CAT','GE','DIS','CSCO','PFE','KO','PEP','CVX','XOM','TGT','MRVL','ISRG','IWM','KLAC','LRCX','MCHP','ON','NXPI','OKTA','ADMA','ASML','CMCSA','GILD','GS','HUM','IBM','LOW','MCD','MCO','MDT','MMM','MS','NKE','RTX','SBUX','SCHW','SPGI','SYK','TFC','UPS','ZTS','BRK-B','C','CI','CL','COF','F']
HK = ['00700','09988','03690','01810','02015','02318','09999','00939','00941','01113','01299','01398','01928','02269','02628','03968','06186','06808','09618','09888','09955','00522','00593','00728','00914','01168','01888','03883','06618','06888']

BATCH = {
    'A': [{'symbol': s, 'market': 'us'} for s in US[:25]],
    'B': [{'symbol': s, 'market': 'us'} for s in US[25:50]],
    'C': [{'symbol': s, 'market': 'us'} for s in US[50:75]],
    'D': [{'symbol': s, 'market': 'us'} for s in US[75:100]],
    'E': [{'symbol': s, 'market': 'us'} for s in US[100:]] + [{'symbol': s, 'market': 'hk'} for s in HK[:15]],
    'F': [{'symbol': s, 'market': 'hk'} for s in HK[15:]],
}

def get_data(symbol, market):
    url = f"https://api.twelvedata.com/time_series?symbol={symbol}&interval=1day&apikey={API_KEY_TD}&outputsize=5000"
    try:
        r = requests.get(url, timeout=15)
        d = r.json()
        if 'values' in d:
            klines = [{'date': v['datetime'], 'open': float(v['open']), 'high': float(v['high']), 'low': float(v['low']), 'close': float(v['close']), 'volume': int(v['volume'])} for v in d['values']]
            return klines[:500]
    except: pass
    return None

def update(stock):
    s, m = stock['symbol'], stock['market']
    for _ in range(3):
        data = get_data(s, m)
        if data:
            f = f"{DATA_DIR}/{'hk' if m == 'hk' else 'us'}_{s}.json"
            with open(f, 'w') as fp: json.dump(data, fp, indent=2)
            return True, len(data)
        time.sleep(2)
    with open(f"{LOG_DIR}/update-failures.log", 'a') as fp: fp.write(f"{s} ({m})\n")
    return False, 0

def retry():
    fail = []
    path = f"{LOG_DIR}/update-failures.log"
    if os.path.exists(path):
        with open(path) as fp:
            for line in fp:
                if line.strip():
                    p = line.split()
                    fail.append({'symbol': p[0], 'market': 'hk' if not p[0].isalpha() else 'us'})
        os.remove(path)
    return fail

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--batch', type=str, required=True)
    args = parser.parse_args()
    b = args.batch
    stocks = retry() if b == 'retry' else BATCH.get(b, [])
    print(f"=== Batch {b}: {len(stocks)} 只 ===\n")
    ok = fail = 0
    for i, s in enumerate(stocks):
        print(f"[{i+1}/{len(stocks)}] {s['symbol']}...", end=" ", flush=True)
        r, n = update(s)
        if r: print(f"✅ {n}条"); ok += 1
        else: print("❌"); fail += 1
        if i < len(stocks)-1: time.sleep(INTERVAL)
    print(f"\n=== 统计 === 成功:{ok} 失败:{fail}")
    return 0 if fail == 0 else 1

if __name__ == '__main__': sys.exit(main())
