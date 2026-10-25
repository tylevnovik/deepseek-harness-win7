<# Build a static-CRT Windows 7 console launcher for the patched Electron Node runtime. #>
param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
$output=[IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force $output | Out-Null
$vswhere=Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$visualStudio=& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if(!$visualStudio){throw 'Win7 Node launcher requires Visual Studio C++ Build Tools and a Windows SDK.'}
$vcvars=Join-Path $visualStudio 'VC/Auxiliary/Build/vcvars64.bat'
$source=Join-Path $PSScriptRoot 'win7-node.c'
$script=Join-Path $output 'compile-node.cmd'
[IO.File]::WriteAllLines($script,@('@echo off',('call "{0}" >nul' -f $vcvars),'if errorlevel 1 exit /b %errorlevel%',('cl /nologo /MT /O1 /W4 /WX "{0}" /Fo"{1}" /Fe"{2}" /link /SUBSYSTEM:CONSOLE,6.01' -f $source,(Join-Path $output 'node.obj'),(Join-Path $output 'node.exe'))),[Text.Encoding]::Default)
& $env:ComSpec /d /c $script
if($LASTEXITCODE -ne 0){throw 'Win7 Node launcher compilation failed.'}
