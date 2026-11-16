# sync-desktop.ps1 — 把重建的 dsh-web-chat 安装包同步进 DSH desktop profile。
#
# 为什么需要：pnpm 的 file: 依赖是「安装时拷贝」，重打包后必须 remove + add 才会生效。
# 注意：本脚本会动到 ~/.dsh（工作区外），请在你自己的终端里直接运行（无沙箱限制）。
#
# 用法：先 node pack.mjs 打包，然后在 PowerShell 里运行  .\sync-desktop.ps1

$ErrorActionPreference = "Continue"
$PSNativeCommandUseErrorActionPreference = $false

$version = "0.6.0"
$tgz = Join-Path $PSScriptRoot "desktop\dsh-web-chat-$version-desktop.tgz"
if (-not (Test-Path $tgz)) { Write-Host "找不到 $tgz，请先运行 node pack.mjs"; exit 1 }
$spec = "file:$($tgz.Replace('\', '/'))"

# 定位 dsh CLI：优先 PATH 里的 dsh；找不到则退回最新的 npx 缓存安装
$dshCmd = Get-Command dsh -ErrorAction SilentlyContinue
if ($dshCmd) {
  $dshLauncher = $dshCmd.Source
  $dshNode = $null
} else {
  $npxCache = Get-ChildItem "$env:LOCALAPPDATA\npm-cache\_npx" -Directory -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $npxCache) { Write-Host "找不到 dsh 命令，也没找到 npx 缓存，请先安装 @deepseek-ai/dsh"; exit 1 }
  $dshLauncher = Join-Path $npxCache.FullName "node_modules\@deepseek-ai\dsh\lib\bin.js"
  $dshNode = "node"
}

Write-Host "==> remove dsh-web-chat (desktop profile)"
if ($dshNode) { & node $dshLauncher plugin --profile desktop remove dsh-web-chat } else { & $dshLauncher plugin --profile desktop remove dsh-web-chat }
Write-Host "==> add $spec"
if ($dshNode) { & node $dshLauncher plugin --profile desktop add $spec } else { & $dshLauncher plugin --profile desktop add $spec }

# 校验：逐文件对比安装副本与 staging 源文件的哈希
$installed = Join-Path $env:USERPROFILE ".dsh\profiles\desktop\node_modules\dsh-web-chat"
$staging = Join-Path $PSScriptRoot "dist-package\package"
Write-Host "==> verify"
$allOk = $true
Get-ChildItem $staging -Recurse -File | ForEach-Object {
  $rel = $_.FullName.Substring($staging.Length + 1)
  $dst = Join-Path $installed $rel
  if (Test-Path $dst) {
    $same = (Get-FileHash $_.FullName).Hash -eq (Get-FileHash $dst).Hash
    if (-not $same) { $allOk = $false }
    "{0}  {1}" -f $rel, $(if ($same) { 'OK' } else { 'DIFF!' })
  } else {
    $allOk = $false
    "{0}  MISSING!" -f $rel
  }
}
if ($allOk) { Write-Host "全部文件一致，同步完成。重启 Harness 桌面版生效。" } else { Write-Host "存在 DIFF/MISSING 文件，请重试或检查。" }