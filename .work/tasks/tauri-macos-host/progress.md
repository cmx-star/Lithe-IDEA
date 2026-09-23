# 进度

## 当前状态

实现和自动验证已完成，等待用户确认。

## 下一步

用户确认后归档任务。

## 阻塞

无。

## 执行记录

- 核对现有 Swift 产品、`windows/tauri` 宿主、终端 crate、平台识别和标题栏实现。
- 确认 macOS 编译阻塞来自无条件的 Windows Cargo features 和 `windows-sys`。
- 新增 `tauri.macos.conf.json`、`desktop:dev:macos`、`desktop:build:macos`。
- 把 `keyring/windows-native`、`tauri/common-controls-v6`、`windows-sys` 移入 Windows
  target dependencies；macOS 内存改用已有依赖 `sysinfo`，未新增 crate。
- `create_app_window` 在 macOS 使用系统装饰和标题栏叠加，其他平台保持无边框。
- 从活动栏、右侧栏、底部面板、命令、快捷键、菜单和编辑器右键断开 Maven、运行、
  调试和 Java 测试入口。
- 断开文件监听的 Maven POM 重载与 Java 工作区变更调度。
- 断开工作区打开时的 Maven 扫描与 JDTLS 预热。
- 编辑器不再为 `.java` 走 JDTLS 加 Maven 启动分支。
- 新增 `.agents/notes/implemented/architecture/2026-09-22-dual-ended-tauri-workbench.md`，
  并在所有权 Note 里补交叉引用。

## 失败尝试

- 最初用 `libc::proc_pidinfo` 读 macOS 内存，需要新增 `libc` 依赖并改 `Cargo.lock`，
  与"不新增依赖"的范围冲突；改为使用已在依赖里的 `sysinfo`。
- 首次 `sysinfo` 调用用了 0.32 不存在的 `ProcessRefreshKind::nothing()` 和
  `Pid::from(u32)`；核对 crate 源码后改为 `ProcessRefreshKind::new().with_memory()`
  并直接传 `Pid`。

## 验证结果

- `cargo check --target aarch64-apple-darwin`：通过，无警告。
- `cargo test --bins`：148 通过，0 失败。
- 合并后的 macOS 配置用 Tauri 2.9.3 `Config` 反序列化：通过。
- `Cargo.lock` 无改动。
- `./scripts/verify-windows-boundaries.sh`：通过。
- `./scripts/verify-service-boundaries.sh`：通过（AppModel 行数为既有告警）。
- `node scripts/verify-editor-boundaries.mjs`：通过。
- `node scripts/verify-java-semantic-ownership.mjs`：通过。
- `./scripts/verify-agent-notes.sh`：30 篇通过。
- 静态补充检查（本机无 Bun，用它替代部分 tsc 能力）：
  - 跨文件导入/导出一致性：1531 个文件、9677 条具名导入，全部能找到对应导出。
  - 改动文件的未使用导入：无。
  - 已删除标识符的残留引用：仅剩对仍存在导出的有效引用。
  - 改动文件括号配对：全部平衡。
- 未执行：`bun test`、`bun run typecheck`（本机无 Bun）；Windows 目标编译（本机是 macOS）。

## 复查时的额外清理

- 复核发现上一轮引入的 `startAfterGit` 是死参数（无生产调用点），函数名
  `runGitBeforeWorkspaceFollowUp` 也不再反映实际行为；改名为
  `runWorkspaceGitBootstrap` 并移除该参数，同步更新调用点与测试。
- 移除 `file-system.store.ts` 中删除代码块留下的连续空行。
