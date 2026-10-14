# Guest self-motion correction / 接收方自身角色校正

## Symptom and reproduction / 症状与复现
The guest alone sees its own fighter pull backwards; the host sees normal motion. Real hidden production hosts over LAN reproduced seven visible reversals with the original 0.6.0 artifact (010fbb1c…). At one received snapshot, frame 388 remained unchanged while the predicted position changed from 44.83 to 41.74; the next actual scene root moved backwards. Evidence: host-e2e 2026-10-14T09-52-48-920Z. The previous smoothness path pressed only the host keyboard and measured seat 0. A monotonic predicted frame number cannot prove monotonic movement.

接收方自身的预测世界收到房主快照后会进行必要的位置校正，但以前直接绘制校正后的坐标。旧平滑测试只操作房主，因此漏测了自身校正跳动。复现使用真实接收方 CDP 键盘与场景提交，没有坐标点击或内部输入写入。

## Fix / 修复
`game/local-motion.cjs` keeps a bounded visual error separate from the simulated world. Small snapshot corrections preserve the current visible position and converge on the render clock (100 ms decay scale, 12-unit reset boundary). Fractional motion fills intervals between physics ticks. Error retirement cannot reverse a walking picture when the predicted projected position holds during catch-up. None of these coordinates are written back to physics or inputs. Pause, reset, new rounds, death, respawn, grabs, inhaling and large discontinuities reset presentation immediately.

本地输入不加入远端的 150 ms 插值缓冲；转向与跳跃仍直接预测。房主规则、协议 v3、状态编码与 pet-kit 0.2.1 均未修改。0.6.1 是候选源码版本，不是发行公告。

## Gates / 验证入口
- `test:local-motion` is included in `test:motion`/`test:rules`/`npm test`: real captured correction, catch-up boundary, unchanged physics, stop convergence and discontinuity behavior.
- `test:host:local-smoothness` and `test:host:local-smoothness:3d` are included in `test:host`/`test:delivery`: real guest keys, normal and 180 ms delayed SDK polls, render trajectories, stop, jump/landing and exactly five attack presses.
- Existing remote smoothness, rules/network/prediction/state/observation gates remain in place. Tests keep original reversal <3%, p95 speed <1.7 and hold <15% thresholds; the new transition gate requires zero visible reverse steps after steady direction begins.
- Configure actual private host and appearance fixtures through existing environment variables; the automatic-pairing host uses `BRAWL_AUTO_PAIRING=1`. No host runtime or private character pack is distributed here.

## Evidence and boundaries / 证据与边界
Initial correction failed the delayed-poll gate (09-55-43-796Z), because a yielded prediction tick still retired the visual error. The fixed path passed 09-57-09-132Z. Two fully decoded 3D fighters passed normal and delayed-poll tests 09-59-48-588Z with zero reversals. These tests use read-only render probes plus an explicitly controlled poll delay; the final uninstrumented HTML is separately verified on two physical Macs through the host catalog.

The full rules/motion/state/observation set passed 436 assertions, with two additional artifact assertions. A first broad command stopped at a missing private host-fixture path; freeze and browser gates were separately rerun with explicit actual host/character paths (not a product failure). Browser gameplay passed including 2D/3D import, all eight styles, music, stages and absence of renderer exceptions.

Native focus, OS compositing and real Keychain are not covered by hidden-window tests. Other games have different local-authority policies; this patch does not claim to fix all multiplayer-game stuttering. Final uninstrumented artifact SHA-256: `bbd91eb17221e44866975d6b8f4ae919e8f7fed012b7e9b6bdd8d6e7c7ee8f8d` (884017 bytes).

## Final real application evidence / 最终真实应用证据
- Two physical Macs, including mac_mini: host run `2026-10-14T10-15-40-302Z` passed actual Test phone/OTP admission, normal LAN interface approval and bidirectional UDP discovery, Vibe catalog file transfer to a separate disk, invitation and two explicit SDK permissions. No test discovery-target bypass was used. Guest actual rendered scene roots had zero reversals in 115 steady samples (p95 speed ratio 1.210606, hold ratio 0.078261); stop converged to authority. Both keyboards, five exact guest attacks, full settlement, mutual rematch and explicit leave passed. Hidden-before-paint and owned process exit were verified; the remote required the guarded termination fallback. Both isolated interface rules and server sessions were cleaned up. Background movement/results screenshots were inspected.
- Final 3D LAN run `2026-10-14T10-21-54-150Z`: zero guest reversals in normal and 180 ms batched polls; p95 ratios 1.041918/1.375297, holds 0/0.068966. Stop, jump/landing and exactly five attacks passed through real keys.
- Production relay regression `2026-10-14T10-18-56-333Z` passed 745 same-serial canonical state comparisons, 30-second measurement, real socket interruption/reconnect, new input, settlement/rematch/leave. This is loopback relay with synthetic tickets, not a repeat of the prior artifact's public-WSS/300-second soak evidence. The fixture was updated to the host's automatic-pairing policy while retaining invitation acceptance and both SDK authorizations.

No shared pet-kit or host SDK API changed. Host, public types, scaffold and registry were checked for impact; the latter three require no synchronization for this game-private presentation fix. No new Release, installer, marketplace publication or server deployment is included.

Existing remote-fighter smoothness path also passed `2026-10-14T10-22-53-040Z`: normal/batched delivery, real key release and peer exit, with unchanged thresholds.
