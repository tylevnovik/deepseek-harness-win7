---
description: "构建 Windows 7 SP1 x64 便携应用，并在既有 ZCode Hyper-V 来宾中验证。"
---

# Windows 7 便携桌面版

[English](README.md) | 中文

## 概要

独立 Windows 7 目标使用 [Electron-for-windows-7 44.2.0](https://github.com/e3kskoy7wqk/Electron-for-windows-7/releases/tag/v44.2.0)、其中的 Node 24.20.0 运行时和 [Python-Win7 3.14.5](https://github.com/Alex313031/Python-Win7/tree/b9e764afe393cc68c26ee065dcebcc25dde21bc9/3.14.5)。目标系统为 Windows 7 SP1 x64，不依赖 Wine、WSL 或替换内核。具体能力是否通过验收，以来宾报告为准。

## 目录

- [构建](#build)
- [运行时选择](#runtime-selection)
- [来宾验证](#guest-validation)
- [限制](#limitations)

<a id="build"></a>

## 构建

构建宿主使用当前 Windows x64、仓库规定的 Node 和 pnpm 版本、Visual Studio C++ Build Tools 及 Windows SDK 10.0.22000.0 的 UCRT 可再发行文件。`DSH_DESKTOP_WIN7_UCRT_DIR` 可以指定包含相同固定校验值 DLL 的其他目录。安装锁定的工作区依赖后，从仓库根目录运行：

```powershell
pnpm --dir apps/desktop run package:win7
```

命令以 `WIN7_PORTABLE` 打印产物目录，运行其中的 `DshHarness.exe`。`--out <new-directory>` 指定尚不存在的目录。失败时保留部分产物，并在 `win7-build.json` 中标记 `status: preparing`。准备流程使用 `.desktop-build/targets/win7-x64/`，与普通 Windows 产物分离。`--skip-build` 复用编译产物；`--skip-prepare` 进一步复用已准备依赖，用于打包诊断。

<a id="runtime-selection"></a>

## 运行时选择

[运行时锁定文件](../scripts/win7-runtime-lock.json) 固定归档校验值和上游源码修订。桌面应用和独立 Node 共用补丁版 Electron。原生 `node.exe` 启动器仅为自己的子进程选择 Node 模式，继承标准流，等待退出并返回子进程退出码。Python 使用匹配的 cp314 库 wheel。

内部模块访问器从固定源码构建，显式加入 44.2.0 指纹；符号、指针、映像和冒烟校验保持启用。兼容目标选择官方 sharp 0.35.5 WebAssembly 包及已有的 LibreOfficeKit WebAssembly 引擎，固定 ripgrep 14.1.0，并在应用、独立 Node 和 Python 可执行文件旁部署 UCRT。Python 虚拟环境会在其启动器旁获得相同的兼容 DLL。生产文件完整性元数据在替换后生成。早于 Windows 10 build 18309 的终端使用 WinPTY，较新系统保留随包 ConPTY；WinPTY 输出关闭时会释放其工作线程。

<a id="guest-validation"></a>

## 来宾验证

适配器复用 `D:/ZCode-oss/tools/win7-vm` 及其持有的 `ZCode-Win7-Validation` 虚拟机。虚拟机必须关闭，且不能有其他运行占用固定网络端口。每次 Harness 验证使用新的来宾目录和私有 Harness home。

```powershell
node apps/desktop/tests/win7-vm/prepare.mjs <portable-directory> D:/ZCode-oss
```

使用输出的 `host-config.json` 路径，在管理员 PowerShell 运行 `powershell.exe -NoProfile -NonInteractive -File <run-directory>/helpers/admin-session.ps1 -ConfigPath <host-config.json>`；在普通终端运行 `node apps/desktop/tests/win7-vm/run.mjs <host-config.json>`。准备流程核对虚拟机归属及部署哈希，仅挂载独立磁盘，复用 ZCode 的认证任务和 CDP 通道。它会替换验证启动项；ZCode 准备流程会在下次运行时重新安装自己的启动项。

报告、截图及私有来宾日志保存在 `D:/VMs/Win7/validation-runs/` 下的本轮目录。token 留在本地配置中。各项场景分别记录结果，任一失败都会使宿主命令以非零状态退出。准备流程单独记录来宾关机和最终虚拟机状态。

<a id="limitations"></a>

## 限制

该目标产出未签名便携应用，不携带普通 Windows 更新源，兼容运行时需要显式重新构建。安装程序签名、外部模型供应商互通及可选原生能力需要独立证据。宿主检查不能单独证明来宾兼容性，请核对当前报告。
