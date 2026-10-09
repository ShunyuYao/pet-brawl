# 邀请联网与无损状态同步（未发布候选）

2026-10-09，基于 `origin/main` d48d897b3930a77cdbc09e4ecbfa3f7928a71590（v0.5.2）在独立工作区实现。未发布、未覆盖日常游戏目录。宿主真实邀请、TLS、中转、取消验证由宿主项目交付记录负责；本文件不把内存 SDK 测试称作公网验收。

## 目标与边界

保留房主权威、60 Hz 战斗规则、本地输入预测和 `remote-motion.cjs` 显示逻辑，仅减少游戏状态重复传输。输入、坐标、生命、事件和弹道均无损；不量化、不降低发送频率。SDK 最新消息可能合并，因此“排队成功”不能作为差分基线的依据。

游戏协议显式升为 `pet-brawl` v2。双方邀请绑定相同 HTML 摘要，不让 v1 负载被猜测成 v2。构建输出：

- `dist/桌宠大乱斗.html`：声明 `interaction.transport:auto`，需支持该声明的新宿主。
- `dist/桌宠大乱斗-LAN.html`：同一套游戏 v2 代码，仅声明 `transport:lan`，适用于支持既有会话 SDK 的旧宿主；不启用公网邀请。
- `dist/build.json` / `dist/build-lan.json`：各自 HTML 摘要、字节数、游戏协议及通道声明。构建时核对 manifest 与运行时代码协议一致。

两个产物均不覆盖已发行的 v0.5.2。旧 HTML 和新 HTML 不在同一邀请中混用；宿主旧 JSON 传输仍能承载此游戏协议，不依赖宿主必须启用新的压缩格式。

## 协议与实现地图

`game/state-codec.cjs` 提供有界 JSON set/delete/event-tail 差分。状态上限 60 KiB、深度 32、节点 8192；拒绝非 JSON、原型相关键、非法路径、隐式路径创建、数组越界与非法事件追加。`view.match.events` 仅当追加并保留最后 64 项能精确得到新状态才使用追加操作，否则普通差分。

`game/state-session.cjs` 管理双方最多 128 项、512 KiB 的状态缓存。每份状态包含 generation、matchNo、serial；delta 引用确认过的 base。完整 canonical JSON 的 SHA-256 必须一致，接收状态且游戏应用成功后才提交缓存和 ACK。失去基线请求全量；周期性全量最多间隔 1 秒，不依赖持续收到 ACK。

`game/state-wire.cjs` 对 full/delta 两个候选分别使用独立 gzip，选择压缩后较小者；全量 JSON 仍超过差分大小时允许选择全量。SDK 消息不超过 60 KiB；解压输入、声明字节数、输出（最多 128 KiB）均有界，解析后继续受状态/操作预算约束。严格检查 envelope 字段、版本、base64、UTF-8、长度与摘要。每帧独立，不共享前帧压缩上下文。

`game/net.cjs` 保持原 `brawl.view` 与 `brawl.input` 消息类型。视图负载为 `{v:2,codec:'gzip-delta',serial,rawBytes,encodedBytes,digest,data}`；确认放入既有 input 的 `stateAck`。静止时仍使用原 200ms 心跳，移动时仍使用原发送调度，不为 ACK 新增 SDK 调用。客端还原后继续 `R.validView → reconcile → remoteMotion.push → onView`；成功后才形成可发送的确认。

epoch、resync、换局触发全量恢复；关闭游戏废弃异步工作。SHA 或 gzip 等待期间若 generation/revision 改变，旧任务不可发送或落缓存。坏摘要/坏包不 ACK，清理依赖并继续处理同批/后批记录；旧 generation/serial 不回退显示。外观传输保持原去重策略，重连/重同步不重发形象。

只读诊断 `window.__brawl.transport().stateWire` 包含有界缓存、full/delta/失败统计，以及各最多 64 项的 `proofs.sent` / `proofs.applied`。双方按 generation+serial 比较 canonical 摘要；sent 仅表示 SDK 已排队，applied 才表示验证及应用成功。记录只包含摘要/序号/字节数，不包含素材或用户明文。诊断快照不可修改内部记录。

## 验证与发现

具名入口 `npm run test:state`（编解码、状态确认、wire、真实 net + latest 合并）和 `npm run test:net`。新测试同时进入 `test:rules`，继而进入已有 `npm test` 聚合。运动回归仍是 `test:motion`。

最终 Node 22.22.2 聚合 `npm run test:rules`：347 项既有规则/网络/姿势、11 项运动、43 项状态同步，共 **401/401 通过，0 失败、0 skip**。第一次聚合遗漏 `PET_BRAWL_ESBUILD` 环境变量，6 个既有套件因隔离目录的依赖路径不能解析而失败；显式指向已有 esbuild 后完整复验通过，没有新增或替换依赖。日志保留在本工作区 `artifacts/state-regression-final.tap`。

本轮 auto 构建 SHA-256 为 `4af86eb4b158b1a7389ecea6243c5f6cbc943dc587cd0510e2fe0d5a9d8402f3`（858932 字节）；LAN 为 `6111e51ad81c6b4246f5f33a05f2177375461f96884e0dc1d42e5d65a22860b2`（858931 字节）。这些标识是未发布候选的构建证据，不是发布回执。

已验证：

- 1200 对随机 JSON、边界/恶意操作与浮点精度；当前游戏 6000 个真实快照无损还原，5995 次历史基线比较，1312 次事件追加，覆盖 64 事件滚动与弹道变化。
- SDK 排队/未收到状态不可确认；丢帧、失去缓存、ACK 丢失、单侧 epoch 提前改变、坏摘要、异步 reset/close 和应用异常后的恢复。
- 实际 `game/net.cjs` 使用真正按 key 合并的 latest 测试队列；静止 ACK 不增加输入调用频率；results→新 countdown 后旧帧不回退。
- 原运动回放的 11 项断言迁移到真实 v2 解码后通过，战斗规则/运动实现保持不变。

发现与处理：旧 `tests/net.test.cjs` 双端模型虽然注释写 latest 合并，实际上逐条投递。新 `net-delta.test.cjs` 的 90ms 队列真实合并快照；防止测试将每个“已发”状态错误当成可用基线。旧运动 helper 固定协议 v1 且直接投递 JSON，升级后先复现 protocol_mismatch，再改成实际 wire 编解码并等待应用，保留原速度/倒退/误差断言。恶意视图回归改为当前 generation 的正确摘要包，确保测到视图校验，而不是提前被过期代际过滤。

边界复查又发现：应用回调同步触发 close/reset 时，回调结束后仍可能写入旧缓存。Agent 在状态层先新增可复现断言（原结果没有 ignored/reset），再增加应用后的 revision 复核，断言通过；以后应用回调也作为代际变更点检查。

宿主正式候选已于本轮完成真实隐藏 Electron 邀请/中转验收，证据为宿主隔离工作区 `artifacts/peer-sessions/brawl-relay/2026-10-09T08-39-29-582Z/report.json`。固定本文件所列 auto SHA，300.153 秒持续战斗；每端至 relay 每方向 75±20 ms / 1 Mbps（完整两端往返约 300 ms 的字节整形，不是公网 IP 丢包）。纯游戏总 socket 出口 24.7039 KB/s，不可压缩 512 KiB 素材并发期间合计 35.6021 KB/s；素材 51.091 秒完成，长度/SHA 一致。6992 组同 generation+serial 状态摘要匹配；发布约 25 Hz、解码约 23.15 Hz、差分占 96.15%。两端 rAF P95 17.6 ms，各一次约 116 ms 长帧；3 秒断网至新输入成功共 8.206 秒，随后结果、互相重赛与退出通过。

这些均为正式产品链路本机证据，未替换 codec 或伪造邀请。并发时 serial lag P95 从 6 升为 7，帧率不代表网络响应毫秒值或真实显示延迟；双设备不同公网和服务器容量仍需另测。完整证据与限制见宿主 `docs/peer-sessions/internet-integration-validation.md`。

## 官方 API 依据

- [WHATWG Compression Standard](https://compression.spec.whatwg.org/#gzip)：独立 gzip member、CRC/ISIZE、尾随数据错误及流式 API。
- [Web Cryptography](https://www.w3.org/TR/webcrypto/#SubtleCrypto-method-digest)：SHA-256 摘要使用异步 SubtleCrypto，不作身份认证替代；身份与邀请授权仍由宿主负责。

English: this unreleased candidate uses lossless, bounded application-level deltas over the existing invitation SDK. Only a verified and successfully applied state is acknowledged, piggybacked on existing input traffic. Epochs, rematches and asynchronous cancellation invalidate old work. The separate LAN build shares all game rules. Node replay evidence does not replace hidden host E2E, cross-network testing or server-capacity measurement.
