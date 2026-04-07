"""
简单情绪分析模块
基于规则匹配为新闻打上 sentiment 标签
"""

import re
from typing import Literal


Sentiment = Literal["positive", "negative", "neutral"]


# 情绪关键词
POSITIVE_WORDS = [
    # 上涨/增长
    "上涨", "增长", "飙升", "大涨", "反弹", "突破", "新高", "强劲", "增长", "盈利", "利润",
    "surge", "soar", "jump", "rise", "gain", "rally", "recover", "bullish", "profit", "beat",
    # 好消息
    "利好", "乐观", "稳定", "创新高", "超预期", "获批", "签约", "合作",
    # 其他
    "buy", "upgrade", "outperform", "overweight", "positive", "strong", "growth",
]

NEGATIVE_WORDS = [
    # 下跌/亏损
    "下跌", "暴跌", "大跌", "跳水", "新低", "疲软", "亏损", "裁员",
    "drop", "fall", "sink", "plunge", "crash", "bearish", "loss", "cut",
    # 风险
    "风险", "违约", "诉讼", "调查", "制裁", "警告", "恐慌", "抛售",
    # 其他
    "sell", "downgrade", "underweight", "negative", "weak", "concern", "risk", "fear",
]

NEUTRAL_WORDS = [
    "持平", "震荡", "观望", "中性", "预期", 
    "flat", "stable", "hold", "neutral", "unchanged",
]


def analyze_sentiment(text: str) -> Sentiment:
    """
    分析文本情绪
    
    Args:
        text: 待分析文本 (标题 + 内容)
    
    Returns:
        positive / negative / neutral
    """
    if not text:
        return "neutral"
    
    text_lower = text.lower()
    
    # 计分
    pos_score = 0
    neg_score = 0
    
    for word in POSITIVE_WORDS:
        if word.lower() in text_lower:
            pos_score += 1
    
    for word in NEGATIVE_WORDS:
        if word.lower() in text_lower:
            neg_score += 1
    
    # 判断
    if pos_score > neg_score:
        return "positive"
    elif neg_score > pos_score:
        return "negative"
    else:
        return "neutral"


def analyze_batch(items: list[dict]) -> list[dict]:
    """
    批量分析新闻情绪
    
    Args:
        items: 新闻列表 [{"title": ..., "content": ...}, ...]
    
    Returns:
        添加了 sentiment 字段的新闻列表
    """
    results = []
    
    for item in items:
        # 合并标题和内容
        text = f"{item.get('title', '')} {item.get('content', '')}"
        
        # 分析情绪
        sentiment = analyze_sentiment(text)
        
        # 添加结果
        item["sentiment"] = sentiment
        results.append(item)
    
    return results


# 测试
if __name__ == "__main__":
    test_texts = [
        "苹果股价飙升创新高",
        "美联储警告经济风险",
        "市场震荡，投资者观望",
    ]
    
    for text in test_texts:
        result = analyze_sentiment(text)
        print(f"'{text}' -> {result}")