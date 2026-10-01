# 把線上對戰伺服器部署到 Zeabur（東京騰訊主機上的 battle-tops 專案）。
# 做法：npm run server:build 打成單一檔 dist-server/index.cjs，在系統暫存區組一份只含 Dockerfile＋index.cjs 的部署目錄，
# 再用 zeabur CLI 直傳（不上傳整個 repo 與 node_modules）。
#   - 基底映像用 AWS ECR Public 的 Node：Zeabur 建置器拉 Docker Hub 曾遇 429 限流。
#   - 服務要設環境變數 ZBPACK_DOCKERFILE_PATH=Dockerfile：2026-10-01 實測 zbpack-v2 直傳時沒有自動採用根目錄的 Dockerfile，
#     只有 index.cjs 的目錄被當成靜態網站、改用 caddy-static 映像（/health 會是 Caddy 回的空白 404）。
#   - 主機記憶體吃緊（其他專案已用約 83%）：Node 堆積上限 192 MB。
#   - 第一次部署會建立服務並把服務 ID 記在 server/zeabur-service.json；之後一律帶上，否則會重複建服務。
# 可重跑（PowerShell 7）：
#   .\scripts\deploy-server.ps1                                       打包＋部署＋等部署結束＋驗證
#   .\scripts\deploy-server.ps1 -StageOnly                            只組部署目錄
#   .\scripts\deploy-server.ps1 -VerifyOnly                           只驗證線上 /health
# 紀錄：logs/server-deploy.log
param(
  [string]$ProjectId = '6abd618f454b8f31a5eff9e8',  # Zeabur 專案 battle-tops（東京騰訊主機 server-69c0fc8a4fe7cb44c896c3e5）
  [string]$ServiceId = '',                           # 既有服務；空值時讀 server/zeabur-service.json，都沒有才建立新服務
  [string]$ServiceName = 'battle-tops-server',       # 第一次部署時的服務名稱
  [string]$VerifyUrl = '',                           # 線上網址（例如 https://battle-tops.zeabur.app）；空值時讀 server/zeabur-service.json 的 url
  [switch]$StageOnly,
  [switch]$VerifyOnly
)
$ErrorActionPreference = 'Stop'

$Root = Split-Path $PSScriptRoot -Parent                                   # repo 根目錄
$Stage = Join-Path ([IO.Path]::GetTempPath()) 'battle-tops-server-zeabur' # 部署目錄（repo 之外）
$LogDir = Join-Path $Root 'logs'
$Log = Join-Path $LogDir 'server-deploy.log'                               # 稽核紀錄
$ServiceFile = Join-Path $Root 'server/zeabur-service.json'                # 服務 ID 與網址
$EndStates = @('RUNNING', 'FAILED', 'CANCELED', 'CRASHED', 'REMOVED')      # 部署的終態
New-Item -ItemType Directory -Force $LogDir | Out-Null

<# 寫一行帶時間的紀錄：同時輸出到主控台與紀錄檔。 #>
function Write-Log([string]$Message) {
  $line = "[$(Get-Date -Format 'HH:mm:ss')] $Message"
  [Console]::Out.WriteLine($line)
  Add-Content -Path $Log -Value $line -Encoding utf8
}

<# 打包伺服器並組部署目錄：Dockerfile＋index.cjs。 #>
function New-Stage {
  Push-Location $Root
  try {
    & npm run server:build 2>&1 | Out-String | Add-Content -Path $Log -Encoding utf8
    if ($LASTEXITCODE -ne 0) { throw "npm run server:build 失敗（見 $Log）" }
  } finally { Pop-Location }
  $bundle = Join-Path $Root 'dist-server/index.cjs'
  if (-not (Test-Path $bundle)) { throw "找不到打包結果：$bundle" }
  if ((Split-Path $Stage -Leaf) -ne 'battle-tops-server-zeabur') { throw "部署目錄路徑異常：$Stage" }
  if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
  New-Item -ItemType Directory -Force $Stage | Out-Null
  Copy-Item $bundle $Stage
  $docker = @'
FROM public.ecr.aws/docker/library/node:24-alpine
WORKDIR /app
COPY index.cjs ./index.cjs
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "--max-old-space-size=192", "index.cjs"]
'@
  [IO.File]::WriteAllText((Join-Path $Stage 'Dockerfile'), $docker.Replace("`r`n", "`n"), [Text.UTF8Encoding]::new($false))
  $kb = [math]::Round((Get-Item (Join-Path $Stage 'index.cjs')).Length / 1KB)
  Write-Log "部署目錄：$Stage（index.cjs ${kb} KB）"
}

<# 呼叫 zeabur CLI（非互動、JSON 輸出），回傳整段輸出文字；結束碼非 0 直接丟錯。 #>
function Invoke-Zeabur([string[]]$CliArgs) {
  $text = & npx --yes zeabur@latest @CliArgs -i=false --json 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { throw "zeabur $($CliArgs[0]) 失敗（exit ${LASTEXITCODE}）：$text" }
  return $text
}

<# 取服務目前所有部署的 ID（用來鎖定「這次」新產生的部署）。 #>
function Get-DeploymentIds([string]$Sid) {
  $text = Invoke-Zeabur @('deployment', 'list', '--service-id', $Sid)
  $json = $text.Substring([Math]::Max(0, $text.IndexOf('[')))
  return @(($json | ConvertFrom-Json) | ForEach-Object { $_.ID })
}

<# 等這次的部署跑到終態：每 20 秒查一次，最多 15 分鐘；回傳終態字串。 #>
function Wait-Deployment([string]$Sid, [string[]]$Before) {
  $deadline = (Get-Date).AddMinutes(15)
  $target = $null
  while ((Get-Date) -lt $deadline) {
    $text = Invoke-Zeabur @('deployment', 'list', '--service-id', $Sid)
    $list = $text.Substring([Math]::Max(0, $text.IndexOf('['))) | ConvertFrom-Json
    if (-not $target) { $target = $list | Where-Object { $Before -notcontains $_.ID } | Select-Object -First 1 }
    if ($target) {
      $now = $list | Where-Object { $_.ID -eq $target.ID } | Select-Object -First 1
      Write-Log "部署 $($now.ID)：$($now.status)"
      if ($EndStates -contains $now.status) { return $now.status }
    } else { Write-Log '尚未看到這次的部署紀錄' }
    Start-Sleep -Seconds 20
  }
  throw '等待部署逾時（15 分鐘）'
}

<# 驗證線上版：/health 回 ok。 #>
function Test-Live([string]$Url) {
  $Url = $Url.TrimEnd('/')
  $r = Invoke-WebRequest "$Url/health" -UseBasicParsing -SkipHttpErrorCheck
  Write-Log "線上 /health：$($r.StatusCode) $($r.Content)"
  if ($r.StatusCode -ne 200 -or ($r.Content | ConvertFrom-Json).ok -ne $true) { throw '線上 /health 驗證未通過' }
  Write-Log '線上版驗證通過'
}

$saved = if (Test-Path $ServiceFile) { Get-Content $ServiceFile -Raw | ConvertFrom-Json } else { $null }
if (-not $ServiceId -and $saved) { $ServiceId = $saved.serviceId }
if (-not $VerifyUrl -and $saved -and $saved.url) { $VerifyUrl = $saved.url }
Write-Log "== deploy-server 開始（專案 ${ProjectId}，服務 $(if ($ServiceId) { $ServiceId } else { '（新建）' })）"
if ($VerifyOnly) { if (-not $VerifyUrl) { throw '-VerifyOnly 需要 -VerifyUrl 或 server/zeabur-service.json 的 url' }; Test-Live $VerifyUrl; return }
New-Stage
if ($StageOnly) { Write-Log '只組部署目錄，結束'; return }

$before = if ($ServiceId) { Get-DeploymentIds $ServiceId } else { @() }
$cli = @('deploy', '--project-id', $ProjectId)
$cli += if ($ServiceId) { @('--service-id', $ServiceId) } else { @('--name', $ServiceName) }
Push-Location $Stage
try { $out = Invoke-Zeabur $cli } finally { Pop-Location }
Write-Log ($out.Trim())
if (-not $ServiceId) {
  $m = [regex]::Match($out, '"service_?[iI][dD]"\s*:\s*"([0-9a-f]{24})"')
  if (-not $m.Success) { throw '部署輸出裡找不到 service ID，請到 Dashboard 查並以 -ServiceId 重跑' }
  $ServiceId = $m.Groups[1].Value
  @{ projectId = $ProjectId; serviceId = $ServiceId; name = $ServiceName; url = '' } | ConvertTo-Json | Set-Content $ServiceFile -Encoding utf8
  Write-Log "新服務 ID：${ServiceId}（已記在 $ServiceFile；之後重新部署會自動帶上）"
}
$state = Wait-Deployment $ServiceId $before
if ($state -ne 'RUNNING') { throw "部署結束狀態為 ${state}：用 npx zeabur@latest deployment log --service-id $ServiceId -t build -i=false 查原因" }
if ($VerifyUrl) { Test-Live $VerifyUrl } else { Write-Log '還沒有網址（server/zeabur-service.json 的 url 為空），略過線上驗證' }
Write-Log '== 完成'
