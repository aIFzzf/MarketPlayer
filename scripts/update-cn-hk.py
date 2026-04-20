#!/usr/bin/env python3
"""
A股/港股 K线数据更新脚本
使用 AKShare 获取A股，富途/AlphaAngle获取港股
"""
import json
import os
import time

try:
    import akshare as ak
    AKSHARE_OK = True
except:
    AKSHARE_OK = False
    print("AKShare not available")

DATA_DIR = os.path.expanduser("~/.openclaw/workspace/MarketPlayer/data/cache/klines")
LOG_DIR = os.path.expanduser("~/.openclaw/workspace/MarketPlayer/logs")

A_STOCKS = [
    ("000001", "平安银行"),
    ("000858", "五粮液"),
    ("300750", "宁德时代"),
    ("600036", "招商银行"),
    ("600519", "贵州茅台"),
]

HK_STOCKS = [
    ("00001", "长和"),
    ("00016", "九龙仓"),
    ("00017", "新鸿基"),
    ("00175", "建行"),
    ("00388", "港交所"),
    ("00700", "腾讯"),
    ("00883", "中海油"),
    ("00914", "中国平安"),
    ("00939", "工行"),
    ("00941", "中国移动"),
    ("01093", "石药集团"),
    ("01113", "汇丰"),
    ("01299", "友邦"),
    ("01398", "工行"),
    ("01810", "小米"),
    ("09988", "阿里"),
]

def update_akshare():
    """使用AKShare更新A股数据"""
    if not AKSHARE_OK:
        print("AKShare not available")
        return 0, 0
    
    ok = fail = 0
    for symbol, name in A_STOCKS:
        try:
            print(f"  {symbol} {name}...", end=" ", flush=True)
            # 尝试获取日K线
            df = ak.stock_zh_a_hist(symbol=symbol, period="daily", start_date="20240101", end_date="20260419")
            if df is not None and len(df) > 0:
                klines = []
                for _, row in df.iterrows():
                    klines.append({
                        "date": str(row["日期"])[:10],
                        "open": float(row["开盘"]),
                        "high": float(row["最高"]),
                        "low": float(row["最低"]),
                        "close": float(row["收盘"]),
                        "volume": int(row["成交量"])
                    })
                klines.reverse()  # 最早的在前
                with open(f"{DATA_DIR}/a_{symbol}.json", "w") as f:
                    json.dump(klines, f, indent=2)
                print(f"✅ {len(klines)}条")
                ok += 1
            else:
                print("❌ 无数据")
                fail += 1
        except Exception as e:
            print(f"❌ {str(e)[:30]}")
            fail += 1
        time.sleep(1)
    return ok, fail

def update_hk_twelvedata():
    """使用Twelve Data更新港股 (修正格式)"""
    import requests
    
    API_KEY = "241820ae70274dc09e534c76eea0a160"
    ok = fail = 0
    
    for symbol, name in HK_STOCKS:
        try:
            print(f"  {symbol} {name}...", end=" ", flush=True)
            # 港股格式: 00001.HK
            url = f"https://api.twelvedata.com/time_series?symbol={symbol}.HK&interval=1day&apikey={API_KEY}&outputsize=500"
            r = requests.get(url, timeout=15)
            d = r.json()
            if "values" in d:
                klines = []
                for v in d["values"]:
                    klines.append({
                        "date": v["datetime"],
                        "open": float(v["open"]),
                        "high": float(v["high"]),
                        "low": float(v["low"]),
                        "close": float(v["close"]),
                        "volume": int(v["volume"])
                    })
                klines.reverse()
                with open(f"{DATA_DIR}/hk_{symbol}.json", "w") as f:
                    json.dump(klines, f, indent=2)
                print(f"✅ {len(klines)}条")
                ok += 1
            else:
                print(f"❌ {d.get('message', 'error')[:30]}")
                fail += 1
        except Exception as e:
            print(f"❌ {str(e)[:30]}")
            fail += 1
        time.sleep(1)
    return ok, fail

def main():
    print("=== A股数据更新 (AKShare) ===")
    a_ok, a_fail = update_akshare()
    
    print("\n=== 港股数据更新 (Twelve Data) ===")
    hk_ok, hk_fail = update_hk_twelvedata()
    
    print(f"\n=== 统计 ===")
    print(f"A股: 成功 {a_ok}, 失败 {a_fail}")
    print(f"港股: 成功 {hk_ok}, 失败 {hk_fail}")

if __name__ == "__main__":
    main()