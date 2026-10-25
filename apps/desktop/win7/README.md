---
description: "Build the Windows 7 SP1 x64 portable application and validate it in the existing ZCode Hyper-V guest."
---

# Windows 7 portable Desktop

English | [中文](README.zh.md)

## Summary

The separate Windows 7 target uses [Electron-for-windows-7 44.2.0](https://github.com/e3kskoy7wqk/Electron-for-windows-7/releases/tag/v44.2.0), its Node 24.20.0 runtime, and [Python-Win7 3.14.5](https://github.com/Alex313031/Python-Win7/tree/b9e764afe393cc68c26ee065dcebcc25dde21bc9/3.14.5). It targets Windows 7 SP1 x64 without Wine, WSL, or a replacement kernel. Guest reports determine which capabilities have passed acceptance.

## Table of Contents

- [Build](#build)
- [Runtime selection](#runtime-selection)
- [Guest validation](#guest-validation)
- [Limitations](#limitations)

<a id="build"></a>

## Build

Use a current Windows x64 host with the repository's Node and pnpm versions, Visual Studio C++ Build Tools and the Windows SDK 10.0.22000.0 UCRT redistributables. `DSH_DESKTOP_WIN7_UCRT_DIR` may name another directory containing the same checksum-pinned DLLs. After installing locked workspace dependencies, run from the repository root:

```powershell
pnpm --dir apps/desktop run package:win7
```

The command prints `WIN7_PORTABLE` and the output directory. Run its `DshHarness.exe`. `--out <new-directory>` selects a directory that does not exist. Failures retain partial output marked `status: preparing` in `win7-build.json`. Preparation uses `.desktop-build/targets/win7-x64/`, separate from ordinary Windows outputs. `--skip-build` reuses compiled artifacts; `--skip-prepare` additionally reuses prepared dependencies for packaging diagnostics.

<a id="runtime-selection"></a>

## Runtime selection

[The runtime lock](../scripts/win7-runtime-lock.json) pins archive checksums and upstream source revisions. Desktop and standalone Node share the patched Electron. The native `node.exe` launcher selects Node mode only for its child, inherits streams, waits for exit and returns the child's exit code. Python uses matching cp314 library wheels.

The internal-module accessor is built from pinned source with an explicit 44.2.0 fingerprint; symbol, pointer, image and smoke validation remain active. The compatibility target selects the official sharp 0.35.5 WebAssembly package and the existing LibreOfficeKit WebAssembly engine, pins ripgrep 14.1.0, and places the UCRT beside the application, standalone Node and Python executables. Python virtual environments receive the same compatibility DLLs beside their launchers. Production integrity metadata is generated after replacement. Terminals use WinPTY before Windows 10 build 18309 and retain bundled ConPTY on newer systems; closing WinPTY output releases its worker.

<a id="guest-validation"></a>

## Guest validation

The adapter reuses `D:/ZCode-oss/tools/win7-vm` and its owned `ZCode-Win7-Validation` VM. The VM must be off and no other run may occupy its fixed network ports. Each Harness run receives a new guest directory and private Harness home.

```powershell
node apps/desktop/tests/win7-vm/prepare.mjs <portable-directory> D:/ZCode-oss
```

Use the printed `host-config.json` path. In elevated PowerShell run `powershell.exe -NoProfile -NonInteractive -File <run-directory>/helpers/admin-session.ps1 -ConfigPath <host-config.json>`. In a normal terminal run `node apps/desktop/tests/win7-vm/run.mjs <host-config.json>`. Setup checks VM ownership and deployed hashes, mounts only independent disks, and reuses ZCode's authenticated job and CDP transports. It replaces the validation startup entry; ZCode setup reinstalls its own entry on its next run.

Reports, screenshots and private guest logs remain under the run directory in `D:/VMs/Win7/validation-runs/`. The token stays in local configuration. Every case records its result, and a failed case makes the host command exit nonzero. Setup records guest shutdown and final VM state separately.

<a id="limitations"></a>

## Limitations

This target creates an unsigned portable application without the ordinary Windows update feed. Compatibility runtimes require explicit rebuilding. Installer signing, external model-provider interoperability and optional native capabilities need separate evidence. Host checks alone do not establish guest compatibility; inspect the current reports.
