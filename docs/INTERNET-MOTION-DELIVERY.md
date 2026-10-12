# 公网运动与预测候选提交记录

2026-10-12，按用户要求提交既有联机优化。分支 `codex/internet-state-delta`；未推送、合并或发布。

## 范围

在已提交的状态增量基础上，补齐输入／状态／画面观测、远端运动处理、客端预测时间线与渐进恢复。保持实际玩法、碰撞与伤害裁定边界。观测只在本地记录，不增加网络报文。具名 motion、motion-delay、prediction-timeline、net、state、observation 门槛已挂入对应聚合入口。

## 验证

此前最终构建完成本机隐藏真实桌宠及301秒云中转组合验收：连续预测7167次，0帧回退、0历史缺口；真实素材、断线恢复、结算、重赛、退出通过。详细证据由宿主专项分支 `docs/peer-sessions/internet-prediction-timeline.md` 和 `internet-transient-backpressure.md` 保存。不是异地设备或容量结论。

提交前复验受影响的 motion、prediction、net、observation 组，结果在被忽略的 `artifacts/commit-check/affected.tap`；未重新部署已清理的临时服务。当前产物与此前真实云验收摘要一致：

- auto HTML：`2cdfad6c236f856d3bdb08ac26f2a2393e7769d5de947413e7b8f4425d3da15f`
- LAN HTML：`48284a054324a46f8d3651f68062377f1529a1ca4a1e3ad833519fd280bf9483`

宿主与本游戏分别提交，不将游戏代码复制进宿主。回退产品改动时保留回归断言。公开推送／合并／部署仍属后续步骤。
