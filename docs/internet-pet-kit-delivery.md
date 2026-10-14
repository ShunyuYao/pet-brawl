# 大乱斗互联网 / pet-kit 适配

本轮固定 pet-kit 0.2.1，默认 HTML 为 auto，另提供相同应用协议的 LAN 文件。应用协议 v3，SDK 声明仍为 v2；双方使用相同文件。源码集成不发布安装包或 Release。

公共 Room 承担会话、轮询、形象与速率预算；保留 StateWire、Prediction、RemoteMotion 及全部游戏裁定。共享 signature 使用本地已验证素材，CPU 玩具策略优先。大厅连接恢复后重新评估双方保留的准备意图，避免双方已准备却不能开局。

最终文件：`dist/build.json`、`dist/build-lan.json` 记录版本、字节、协议与摘要。auto 文件为 `010fbb1cd2945b3069e3d006ebbaaa6f8a40eca967b48278b102bc6bae61e198`，882467 bytes。此前 919f 开头的报告是准备恢复修复前的历史，不能替代最终字节验收。

## 最终验证

- 具名 stale-ready 网络回归由红转绿；升级后网络/差分20项、观察1项及产物2项通过。原规则/运动/时钟/预测/状态回放保持原门槛；不把分开执行的结果写成一条新增完整全仓回归。
- 真实浏览器80项通过，包含真实重载、音乐实际推进、地图与3D形象、结果和自有进程回收。异常字符串不再被当作就绪；音频仍要求现有5秒启动期限内实际推进。
- 隐藏真实宿主 backpressure/lobby `06-51-36-359Z`：断网期间真实准备、恢复开局、受阻后不重连、双向移动/精确攻击、预测、结算、再战与离场通过。
- 当前强制登录宿主 shared `07-04-50-801Z`：真实隔离生产账号服务登录，同款/不同款3D形象、局中共享外观、地图/流派、伤害、断线、结算和再战通过。战斗形象正确；已有左侧自身HUD头像在局中变化后可能保留默认样式，不宣称已修复该视觉细节。
- 最终弱网长程 `08-38-24-082Z`：实际生产认证relay与独立代理，双向每段1Mbps、75ms±20ms，连续300.211秒，6809个相同代次/serial状态摘要一致；512KiB实际51,825ms收到正确摘要；完整trace无丢弃/错误，7369个连续预测记录零退帧；两端画面间隔p95为18.0/17.9ms且无>50ms帧。3秒真实socket中断后8,020ms恢复，后续输入、结算、再战、离场通过。

所有应用首次绘制前隐藏，隔离userData/端口、真实CDP键盘操作、后台截图与实际PID退出。弱网测试是本机生产relay模块加TCP字节流整形，合成账号票据与隔离钥匙串；不等于实体公网弱网或服务器容量测试。

## 失败与边界

历史长程 `07-28-58-956Z` 与 `08-17-35-264Z` 出现非注入超时重连，严格保留FAIL。后者真实关闭原因为receipt_timeout，控制器同期停顿6459ms；独立relay事件循环未完整观测，不能证明全部原因。本机重启后的原条件重放通过，不将一次通过描述为全部根因修复或任意负载保证。

历史实体公网报告 `06-07-06-863Z` 使用旧登录宿主与919f字节。上游独立登录任务已部署新Test服务；当前强制登录入口的双Mac最终验收另记，不把旧报告替代新路径。原生Keychain、实体弱网、安装包与OS焦点/合成未覆盖。远端SIGTERM若超时，按本轮root/PID/独立进程组核对后SIGKILL，不称优雅退出。

## English verification boundary

The shared library owns room/transport/appearance lifecycle. Game authority, prediction and motion remain game-specific. The final artifact and retained ready-intent recovery pass the named real-app and shaped-network gates above. Reports for older artifact hashes remain historical.

The 300-second gate uses production relay modules, synthetic tickets and isolated hidden apps on one machine. Physical Test-account acceptance has a separate report. Prior receipt-timeout failures are retained: a later passing run does not establish that their entire cause was repaired. No installer, marketplace entry, host download location or server deployment is published by this delivery.

## 当前准入的实体公网复验

`2026-10-14T08-52-30-372Z` OK：本轮最新Test登录修复集成源码、两台实体Mac，真实UI获取开发验证码并登录、好友申请/接受、禁LAN的公网WSS递送、双方磁盘010f摘要、配对和SDK同意、真实移动/精确5次攻击、同一结算、互相再战和显式离场全部通过。后台玩法与结果截图已检查。新准入重登失效化旧会话与HTTP200登出、自有PID实际退出通过；远端使用归属核对后的SIGKILL兜底。

The final 010f artifact also passes two physical Macs through the newly deployed Test admission service, real development-OTP UI, friend requests and public WSS with LAN disabled. Both disks match; input, settlement, rematch, departure and server-side account cleanup are verified. Mock Keychain and guarded remote termination remain explicit boundaries.
