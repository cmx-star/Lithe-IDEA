# Agent 笔记：双端 Tauri 工作台与 Java 能力退出

状态：已实现

## 先说结论

`windows/tauri` 这套 React 工作台现在也能作为独立 macOS 应用启动，用的是新增的
`tauri.macos.conf.json` 宿主配置，而不是重写一套前端。现有 Swift macOS 产品继续
保留，两边暂时并存。同一套工作台不再提供 Java、Maven、运行和调试入口：Java 文件
按普通文本编辑，通用 LSP 诊断仍然保留。开发者以后加功能时，默认假设这段前端
是双端的，平台差异必须显式分支，不能假设运行在 Windows。

## 问题

仓库此前是两套独立产品：macOS 用 SwiftUI/AppKit，Windows 用 React/Tauri，只共享
`rust/lithe-core`。两端工作台表现层无法复用，编辑器之外的界面行为要维护两份。

同时，这套 React 工作台带着完整的 Java 工具链入口：活动栏的 Maven 与 Run、底部
面板的 Maven 输出与调试器、编辑器右键的"运行测试类/方法"、打开工作区时自动预热的
JDTLS，以及文件监听触发的 Maven POM 重载。这些能力依赖 Windows 专属的进程、JDK
探测和 JDTLS 打包，直接搬到 macOS 会让 macOS 宿主第一次启动就依赖一套尚未验证的
Java 环境。

## 决策

### 新增 macOS Tauri 宿主，复用同一套前端

新增 `windows/tauri/src-tauri/tauri.macos.conf.json`，通过 Tauri 的平台配置叠加机制
覆盖窗口和打包设置：

- 窗口使用系统装饰（`decorations: true`）和 `titleBarStyle: Overlay`，让 macOS 显示
  原生红绿灯；前端已有的 `IS_MAC` 标题栏分支用左侧留白避开红绿灯。
- 打包目标为 `.app`，声明 `icon.icns` 和最低系统版本 13.0。
- 使用 `app.lithe.desktop.tauri` 作为标识，避免和 Swift 产品的 `app.lithe.desktop`
  在钥匙串、单实例和更新通道上互相干扰。

Windows 继续用 `tauri.windows.conf.json` 的无边框窗口和自绘窗口按钮。窗口装饰的
差异落在宿主 Rust 里：`create_app_window` 在 macOS 用系统装饰加标题栏叠加，其他
平台保持无边框。

### 把 Windows 专属依赖改成按目标平台启用

宿主 `Cargo.toml` 之前无条件启用 `keyring/windows-native`、`tauri/common-controls-v6`
和 `windows-sys`，这三项直接让 macOS 编译失败。现在它们都移进
`[target.'cfg(windows)'.dependencies]`，`keyring` 在 macOS 走默认系统钥匙串后端。
macOS 的进程内存改用依赖里已有的 `sysinfo`（`Process::memory()` 返回常驻内存），
没有新增 crate，`Cargo.lock` 保持原样。

### Java、Maven、运行和调试退出这套工作台

断开的是入口和自动触发，不是删除实现文件：

- 活动栏、右侧栏、底部面板、命令注册表、默认快捷键、菜单和编辑器右键不再提供
  Maven、Run、Debug 和 Java 测试入口。
- 打开工作区不再扫描 Maven、不再预热 JDTLS；文件监听不再触发 Maven POM 重载和
  Java 工作区变更调度。
- 编辑器不再为 `.java` 走 JDTLS 加 Maven 的启动分支，改为和普通语言一样只查扩展
  注册表。

`features/maven`、`features/run`、`features/debugger`、`features/spring`、`features/mybatis`
的实现文件和 Rust host 里的对应命令都保留。以后要做 macOS Java 支持时，重新接线比重写便宜。

### 顺带修掉的跨平台缺陷

macOS 目标第一次编译，暴露了三个只在非 Windows 上失败的问题：

- `run.rs::validate_write_target` 用硬编码 `\` 做前缀比较，macOS 上会拒绝所有项目
  子目录写入。改成按路径组件比较，Windows 保留大小写不敏感。
- `workspace_relative_paths_use_forward_slashes` 和
  `derives_adapter_identifier_from_the_executable_name` 只用 Windows 字面路径，在
  macOS 上无法解析。改成按平台断言同一契约。
- `run.rs` 三个 Windows 专用辅助函数在 macOS 上产生 dead-code 警告，加 `cfg_attr`
  抑制，不改 Windows 行为。

## 考虑过的备选方案

### 用 Tauri 工作台替换 macOS Swift 产品

这样能彻底消除两套表现层。但 Swift 产品承载了大量尚未迁移的能力（签名、公证、
自动更新、Homebrew、Java 工具链），一次替换会让用户可见功能倒退。因此这一步只做
"新增宿主、并存"，不删除 Swift 产品。

### 保留 Java 入口，在 macOS 上显式失败

入口还在，点下去报"macOS 暂不支持"。这样代码改动最小。但会出现用户能点到、却永远
失败的按钮，而且 JDTLS 预热、Maven 扫描这些自动路径仍会在 macOS 上启动一套未验证
的工具链。因此改为直接断开入口和自动触发。

### 让 macOS 也走无边框窗口，自绘红绿灯

这样两端窗口外观一致，标题栏代码只需一套。但 macOS 用户会失去系统级的窗口行为
（全屏、Mission Control、窗口菜单），自绘红绿灯也很难做对。因此 macOS 用系统装饰，
差异留在宿主。

## 后果

- 这套 React 工作台变成双端共享表现层。新增界面代码默认两端都跑，平台差异必须用
  `IS_MAC`/`IS_WINDOWS` 显式分支；直接假设 Windows 会在 macOS 上表现为布局错位或
  调用失败。
- macOS 目前只有编辑器、文件、Git、搜索、终端和诊断。Java/Maven/运行/调试在
  macOS 上不可用，这是有意为之，不是缺陷。
- 前端 Java 相关模块暂时成为不可达代码。它们仍会被类型检查，但不再有调用点；
  改动它们不会影响当前产品行为。
- 两端共用 `app.lithe.desktop.tauri` 之外的 Windows 标识仍是 `app.lithe.windows`，
  钥匙串条目和单实例锁不会和 Swift 产品串。
- macOS 宿主尚未接入签名、公证和自动更新。它是开发态可启动的应用，不是可发布产品。

## 验证

- `cargo test --manifest-path windows/tauri/src-tauri/Cargo.toml --bins`：148 通过，
  含新增的 macOS 常驻内存测试。
- `cargo check --manifest-path windows/tauri/src-tauri/Cargo.toml --target aarch64-apple-darwin`：
  通过，无警告。
- `./scripts/verify-windows-boundaries.sh`
- `./scripts/verify-service-boundaries.sh`
- `node scripts/verify-editor-boundaries.mjs`
- `node scripts/verify-java-semantic-ownership.mjs`

macOS 配置的字段名和取值用 Tauri 2.9.3 的 `Config` 类型反序列化校验过。前端改动
在本机没有 Bun，未运行 `bun test` 和 `bun run typecheck`。

## 适用范围

- `windows/tauri/src-tauri/tauri.macos.conf.json`
- `windows/tauri/src-tauri/tauri.windows.conf.json`
- `windows/tauri/src-tauri/Cargo.toml`
- `windows/tauri/src-tauri/src/host.rs`
- `windows/tauri/src-tauri/src/memory.rs`
- `windows/tauri/src-tauri/src/run.rs`
- `windows/tauri/src/features/layout/`
- `windows/tauri/src/features/keymaps/`
- `windows/tauri/src/features/editor/`
- `windows/tauri/src/features/file-system/`
- `windows/tauri/src/features/workspace/`
- `windows/tauri/package.json`
