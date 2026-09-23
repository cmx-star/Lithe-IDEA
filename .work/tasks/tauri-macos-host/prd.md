# macOS Tauri 宿主

## 目标

让现有 `windows/tauri` React 工作台能作为独立 macOS 应用启动。现有 Swift macOS 产品继续保留，不删除、不替换。

用户能观察到：在 macOS 上执行 `bun run desktop:dev:macos` 后，出现一个带红绿灯的 Lithe 窗口；标题栏内容避开红绿灯，窗口可以拖动、最小化、缩放和关闭。可以打开文件、编辑并保存，也可以打开终端。侧边栏、底部面板和命令入口不再出现 Java、Maven、运行或调试。

## 范围

- 新增 macOS Tauri 配置、开发脚本和 `.app` 打包目标。
- 把宿主 crate 中无条件的 Windows 依赖改成目标平台依赖。
- 为 macOS 窗口使用原生装饰和交通灯安全区。
- 补齐 macOS 进程内存读取，让现有内存命令返回真实数值。
- 增加 macOS 目标能编译通过的 Rust 回归，以及标题栏避让的前端回归。
- 从双端 React 工作台移除 Java、Maven、运行和调试入口。通用语言诊断和编辑器内导航保留。

## 排除项

- 不删除 `macos/` Swift 产品，也不修改它的发布流程。
- 不把 macOS 的签名、公证、自动更新或 Homebrew 发布接到这个新宿主。
- 不重做 Windows 工作台的编辑器、文件、Git 或终端，不迁移 Swift 专属功能。
- 不删除 `features/java`、`features/maven`、`features/run`、`features/debugger` 的实现文件；只断开工作台入口。
- 不删除 Rust host 中现有的 Java、Maven、运行和调试命令；macOS 只是不再提供入口。
- 不新增、升级或替换任何依赖。
- 不修改共享 Rust Core 契约、命令名或 JSON 字段。

## 必须保持

- Windows 配置继续使用无边框窗口和现有 Windows 窗口按钮。
- 前端仍只能通过 `@/platform/tauri-core` 调用 Tauri core API。
- `app.lithe.desktop` 仍只属于现有 Swift 产品；新宿主使用 `app.lithe.desktop.tauri`。
- 凭据存储继续使用现有 `keyring` 命令；macOS 使用其默认系统钥匙串后端。

## 项目事实

- 仓库现况是 macOS Swift 产品加 `windows/tauri` React/Tauri 产品，共享行为在 `rust/lithe-core`。
- `windows/tauri/src/utils/platform.ts` 已能识别 macOS，标题栏也已有 `IS_MAC` 分支和 `pl-23.5` 左侧留白。
- 宿主入口是 `windows/tauri/src-tauri/src/main.rs`。终端 crate 已用 `portable-pty` 区分 Windows 与 Unix。
- 直接阻塞 macOS 编译的是宿主 `Cargo.toml` 中无条件启用的 `windows-native`、`common-controls-v6` 和 `windows-sys`。
- 非 Windows 的 `get_application_memory_usage` 目前固定返回“仅 Windows 可用”。
- `keyring` 3.6.3 在未启用 `windows-native` 时走默认平台后端；仓库锁文件已经包含该 crate。

## 方案

1. 新增 `tauri.macos.conf.json`，窗口保留系统装饰、`titleBarStyle: Overlay` 和隐藏标题，打包目标为 `.app`，并声明 `icon.icns`。
2. 增加 `desktop:dev:macos`、`desktop:build:macos`。
3. 将 Windows 专属 Cargo features 和 `windows-sys` 放入 Windows target dependencies；`keyring` 只在 Windows 启用 `windows-native`，macOS 用默认系统钥匙串后端。
4. 在 macOS 上创建窗口时使用系统装饰和标题栏叠加；Windows 和其他系统继续保持无边框。macOS 标题栏继续用现有左侧留白避开红绿灯。
5. 用已在依赖里的 `sysinfo` 读取当前进程的常驻内存（`Process::memory()`），作为 macOS 的进程内存值；不新增依赖。
6. 保持非 macOS、非 Windows 平台的现有明确失败，避免把未实现平台伪装成零内存。
7. 从活动栏、右侧栏、底部面板、命令、菜单和编辑器右键断开 Maven、运行、调试和 Java 测试入口；同时断开文件监听触发的 Maven POM 重载与 Java 工作区变更调度，以及编辑器对 `.java` 的 JDTLS/Maven 启动。Java 文件仍按普通文本编辑；通用 LSP 诊断继续保留。

## 验收

- macOS 开发窗口显示系统红绿灯，标题栏内容不重叠。
- 打开文件、保存文件、创建终端在 macOS Tauri 宿主中可用。
- macOS 和 Windows 的同一套 React 工作台都不再显示 Java、Maven、运行或调试入口。
- `cargo check --target aarch64-apple-darwin --manifest-path windows/tauri/src-tauri/Cargo.toml` 通过。
- Windows 目标的现有边界检查仍通过。
- 内存命令在 macOS 返回大于 0 的当前进程值，其他非 Windows 平台仍返回明确错误。

## 验证

- `cargo check --target aarch64-apple-darwin --manifest-path windows/tauri/src-tauri/Cargo.toml`：通过，无警告。
- `cargo test --manifest-path windows/tauri/src-tauri/Cargo.toml --bins`：148 通过，0 失败（含新增的 macOS 常驻内存测试）。
- 合并后的 macOS 配置用 Tauri 2.9.3 的 `Config` 类型反序列化校验：通过。
- `windows/tauri/src-tauri/Cargo.lock` 无改动，未新增依赖。
- `./scripts/verify-windows-boundaries.sh`：本机没有 `rg`，脚本无法真正执行断言。
- `cd windows/tauri && bun test ...` 与 `bun run typecheck`：本机没有安装 Bun，未执行。前端改动只做了静态引用与括号配对检查。

本机是 macOS，不能在这里执行 Windows 目标编译，也没有 Bun 与 `rg`。

## 附带修复

macOS 目标第一次编译暴露了三个只会在非 Windows 上失败的问题，已一并修正：

- `run.rs` 的 `validate_write_target` 用硬编码 `\` 做前缀比较，macOS 上会拒绝所有项目子目录写入；改为按路径组件比较。
- `run.rs::workspace_relative_paths_use_forward_slashes` 与 `debug.rs::derives_adapter_identifier_from_the_executable_name` 只用 Windows 字面路径，macOS 上无法解析；改为按平台断言同一契约。
- `run.rs` 三个 Windows 专用辅助函数在 macOS 上产生 dead-code 警告；加 `cfg_attr` 抑制，不改 Windows 行为。

## 风险

- `cargo check` 只能证明 macOS 目标可编译，不能代替真实窗口、钥匙串授权和终端手测。
- 无边框窗口改成 macOS 系统装饰后，若标题栏留白不足，红绿灯会挡住菜单或项目按钮。
- 当前进程 RSS 不等于 Swift 产品统计的整组应用内存，不能拿来做跨产品数值对比。

## 未知项

- macOS 钥匙串首次授权弹窗是否会打断开发态启动，需要运行时确认。
- 终端在 macOS 上的默认 shell 与环境变量继承，需要打开一个真实终端确认。
