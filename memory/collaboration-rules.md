# 协作规则更新 - 2026-04-18

## Claude ↔ OpenClaw 沟通协议

### 规则内容
1. **唯一通信渠道**: Claude (claude-internal) 与 OpenClaw 的唯一沟通渠道是 commander
2. **内部路由**: 所有来自 Claude 的指令发至 commander，由 commander 负责内部路由给其他 agent
3. **飞书同步**: 每次回复 Claude 的同时，必须通过飞书发送同步通知，确保用户在飞书看到回复内容

### 执行要求
- commander 回复 Claude 后，立即调用 message 工具发送飞书通知
- 飞书通知包含简要说明 + 回复概要

---

*记录时间: 2026-04-18 22:36 GMT+8*