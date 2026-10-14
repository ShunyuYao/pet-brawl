# 大乱斗互联网 / pet-kit 适配候选

源码候选已完成本轮验收（2026-10-14）；安装包与 Release 尚未发布。

- 公共库固定 pet-kit 0.2.1，vendored 源码由库工具导出并在构建时重新核验摘要。
- 默认 HTML 声明 auto，单独 LAN 文件使用相同应用协议；SDK 声明仍为 v2。既有附件不自动升级，双方使用相同文件。
- 保留游戏规则、预测、插值、人数和原有断线/退出义务。联网由宿主邀请、同意和认证会话承担。
- 产物版本、字节数、协议和 SHA-256 以 dist/build.json、dist/build-lan.json 为准。
- 隐藏真实应用使用隔离数据与端口、真实 CDP 输入、后台截图；仅清理本轮进程。

## Verification boundary / 验证边界

已通过：347规则/网络、11 motion、8 delay、13 prediction、43 state、10 observation；实际嵌入库32项、产物契约及隐藏单人/法师回归。保留原预测门槛，串行执行防止测试彼此制造负载。

真实双宿主LAN `2026-10-14T04-56-05-497Z`：完整3D外观、地图/流派/准备、键盘移动、5次客端攻击、实际短断连、双方伤害、局中宠物变化、结算/再战/退出通过。法师 `04-57-31-881Z` 与运动专项 `05-00-56-222Z` 通过；后者实际延迟22次poll，180ms延迟路径保持零倒退和零停顿（原速度p95<1.7门槛）。

实际生产relay模块在loopback的长程 `2026-10-14T04-24-14-463Z`：300秒、并发512KiB素材实际接收摘要、6009个同serial状态摘要、3秒socket中断后的新攻击/反向输入、结算/再战/退出全部通过。转发与测试控制器使用独立进程；旧同进程转发的失败与对照保留。一次通过不代表任意负载下零长帧。

两个实体Mac经现有Test公网服务 `2026-10-14T04-44-34-017Z`：真实登录/好友、游戏库发送/独立磁盘摘要、配对/SDK同意、双方移动/攻击、同一结算、再战/离场、账号服务端登出和实际进程退出通过。禁用LAN，首次绘制前隐藏。远端优雅退出未成功，归属核对后SIGKILL兜底并记录；原生Keychain用隔离AES夹具替代，未验安装包或实体弱网。

失败记录：3D用例原30秒测试期限过短，实际完整呈现耗时32666ms；采用宿主现有130秒素材期限。运动测试旧花括号截取生成非法JS，新增完整调用扫描、编译门槛与旧失败回归；没有修改游戏字节。原始日志/截图保留在验收工作区 artifacts，未公开账号或验证码。

This source candidate does not publish an installer, marketplace entry or host download location. The shared game library owns transport and appearance lifecycle; game-specific authority and prediction remain in the game. Physical Test-account acceptance is a separate gate from loopback tests.

Qualified source only; no installer or Release is published. Physical Test-account E2E, loopback performance and isolated key-store testing have distinct scopes. The tested game preserves its existing authority, prediction and renderer.
