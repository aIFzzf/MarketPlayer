# NOTIFY_CONFIG.md - 推送渠道配置

## 可用渠道

### 飞书 (Feishu) ✅
- chat_id: **oc_e6d8f6dd5b7fe5ec6627abb8f19ace54**
- app_id: cli_a927ea1b10385bd7
- 状态: 已配置
- 使用方式: `feishu_chat` 工具或 `lark-cli im +messages-send`

### Telegram
- bot_token: (待配置)
- chat_id: (待配置)

### 邮件
- smtp_host: smtp.qq.com
- smtp_port: 465
- from: 845567595@qq.com
- to: (待配置)
- 状态: SMTP 授权码需更新

### 微信
- (待研究 OpenClaw 支持情况)

---

## 触发条件

### 高优先级 (立即推送)
- 阻塞风险出现
- 重大 Bug
- 任务完全停滞

### 中优先级 (日报附带)
- 进度延期 > 20%
- 风险数量增加

### 低优先级 (周报附带)
- 常规进度更新
