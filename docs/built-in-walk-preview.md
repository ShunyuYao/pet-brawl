# 大乱斗内置走路试验

2026-10-15 用户要求先只换大乱斗，在独立分支看效果。分支 `codex/brawl-built-in-walk` 从新鲜 origin/main `b6a9240` 创建；此次是本地预览，保留分支供评审，不合并游戏 main 或宿主 Test，不更新默认游戏目录、不发包。

已具备：游戏源码、原 walk 素材、既有完整帧 SDK 候选、真实隐藏客户端及账号夹具。缺失依赖：无。可独立准备：动作切换与原格斗姿态回归。阻塞项：无。

## 实现

- `src/walk-animation.js` 使用现有 `character.getAnimationCatalog/getAnimation` 分页读取当前角色完整 walk，保留顺序、fps、loop、face。待机仍为一帧；只有地面 walk/run 状态用新动画，攻击/跳跃/受击继续原格斗姿态。
- 所有动作帧共同计算裁切边界，统一画布与脚底位置；在既有 1 MiB 形象传输限制内按空间分辨率压缩 WebP，不抽时间帧。缺 walk 或旧宿主保留同一宠物的旧静态路径。3D 布偶与游戏自带玩具角色保持原渲染。
- `src/characters.js` 组装/校验可携带 walk 的形象；`src/avatars.js` 切换实际材质帧并释放资源；`src/scene.js` 只传递已有模拟状态并提供只读诊断。不修改碰撞、速度、攻击判定或联网预测。
- 预览运行依赖已有宿主动画分支 `codex/game-character-animation f59ce47d`；该工作树只读使用，未修改 SDK。普通 Test 还没有对游戏开放这两个动画方法，不能用本次预览声称已发布支持。
- 宿主及 pet-plugin-types、create-pet-plugin、pet-plugin-registry 不属于本次修改范围：消费已有候选接口，没有新增公开契约、权限、类型或市场条目；三仓候选仍由原动画 SDK 需求维护，本轮不发布这些仓库。

## 验证

改动 → 帧选择/输入校验 → `test:walk`（归 `test:rules`）；改动 → 格斗姿态邻接边界 → `test:poses`；构建 → 产物摘要 → `test:artifact`；实际 SDK/权限/按键/材质 → `test:host:walk`（归 `test:host`）。测试位于游戏自身项目。

- `test:walk` 3/3，`test:poses` 34/34，`test:artifact` 2/2；构建成功。
- 首次姿态测试缺少隔离 worktree 的 esbuild 路径，使用项目已有 `PET_BRAWL_ESBUILD` 指向实际依赖后通过，没有把缺依赖计通过。
- 隐藏真实 Electron 证明：读取当前奇奇完整 20 帧 walk、左右方向正确、实际材质随时间变化、松开回 idle、空中及攻击不继续走路；通过真实权限窗口及 CDP 键盘。不会注入游戏位置或结果。
- 验收脚本先修正 chat 页空正文就绪判据；预览显示阶段发现游戏使用 BaseWindow，改为通过其实际 contentView 定位，仅在显式 preview 模式且全部断言后显示。应用与作品窗口隐藏证据分开检查，避免只观察 BrowserWindow 漏掉作品。
- 本轮只验本地试用效果，未声称双机同步、所有角色或 3D 格斗已完成新一轮验收。截图及报告在 `artifacts/walk-host/`。

## 运行

给 `PET_BRAWL_ESBUILD` 指定已有 esbuild 路径后执行 `npm run build`。给 `BRAWL_HOST_ROOT` 指定支持完整动画接口的候选宿主根目录后执行 `npm run test:host:walk`。增加 `BRAWL_WALK_PREVIEW=1` 则在隐藏断言完成后显示真实游戏；进程使用一次性的隔离账号与用户目录，退出启动器会清理自己启动的服务。

Context7 本轮不可用；Three 材质/纹理操作参考官方文档 https://threejs.org/docs/ ，实际沿用项目锁定 r164 的已有材质替换与 dispose 路径。
