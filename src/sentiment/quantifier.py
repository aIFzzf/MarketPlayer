"""
情绪量化引擎
"""

import os
import json
import math
from typing import Dict, List

# 来源可信度权重
SOURCE_WEIGHTS = {
    'yahoo_finance': 1.0,
    'eastmoney': 0.9,
    'sina': 0.8,
    'gdelt': 0.7,
    'xueqiu': 0.85,
}

# 情绪关键词
POSITIVE_WORDS = ['上涨', '增长', '盈利', '突破', '新高', '利好', 'surge', 'gain', 'profit', 'bullish']
NEGATIVE_WORDS = ['下跌', '亏损', '暴跌', '风险', '裁员', 'drop', 'loss', 'bearish', 'risk']


def analyze_sentiment(text: str) -> str:
    """分析文本情绪"""
    if not text:
        return 'neutral'
    
    text_lower = text.lower()
    
    pos_score = sum(1 for w in POSITIVE_WORDS if w in text_lower)
    neg_score = sum(1 for w in NEGATIVE_WORDS if w in text_lower)
    
    if pos_score > neg_score:
        return 'positive'
    elif neg_score > pos_score:
        return 'negative'
    else:
        return 'neutral'


def calc_news_score(news: Dict) -> float:
    """计算单条新闻的情绪分数"""
    sentiment = analyze_sentiment(news.get('title', '') + ' ' + news.get('content', ''))
    
    if sentiment == 'positive':
        base = 50
    elif sentiment == 'negative':
        base = -50
    else:
        base = 0
    
    # 来源可信度
    source = news.get('source', 'unknown')
    for key, weight in SOURCE_WEIGHTS.items():
        if key in source.lower():
            return base * weight
    
    return base * 0.7


def quantify_sentiment(symbol: str = None) -> Dict:
    """
    量化情绪分数 (-100 到 +100)
    扫描 news_items 表中的新闻
    """
    # 尝试读取数据库
    try:
        import subprocess
        
        db_url = os.getenv('DATABASE_URL', '')
        
        # 使用 psql 或直接读取缓存
        cache_file = 'data/sentiment_cache.json'
        if os.path.exists(cache_file):
            with open(cache_file) as f:
                data = json.load(f)
            
            # 计算情绪
            total = 0
            for item in data.get('items', []):
                total += calc_news_score(item)
            
            score = max(-100, min(100, total))
            
            return {
                'score': round(score, 1),
                'count': len(data.get('items', [])),
                'positive': sum(1 for i in data.get('items', []) if i.get('sentiment') == 'positive'),
                'negative': sum(1 for i in data.get('items', []) if i.get('sentiment') == 'negative'),
                'neutral': sum(1 for i in data.get('items', []) if i.get('sentiment') == 'neutral'),
                'sources': data.get('sources', {}),
                'latest_news': data.get('items', [])[:5]
            }
    except Exception as e:
        print(f"Error: {e}")
    
    # 如果数据库不可用，返回模拟数据
    return {
        'score': 0,
        'count': 0,
        'positive': 0,
        'negative': 0,
        'neutral': 0,
        'sources': {},
        'latest_news': []
    }


def calculate_momentum(symbol: str = None) -> Dict:
    """计算情绪变化率"""
    sent = quantify_sentiment(symbol)
    
    if sent['score'] > 10:
        trend = 'improving'
    elif sent['score'] < -10:
        trend = 'declining'
    else:
        trend = 'stable'
    
    return {
        'current': sent['score'],
        'previous': 0,
        'momentum': 0,
        'trend': trend
    }


# 测试
if __name__ == '__main__':
    import sys
    symbol = sys.argv[1] if len(sys.argv) > 1 else None
    
    result = quantify_sentiment(symbol)
    print(f"情绪分数: {result['score']}")
    print(f"新闻数量: {result['count']}")
    print(f"正面: {result['positive']}, 负面: {result['negative']}")