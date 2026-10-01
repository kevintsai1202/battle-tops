# 五個場地各跑一次平衡報表，結果寫到 logs/balance-<場地>.log，最後列出每個場地勝率最高與最低的三顆（調數值時用）
# 用法（PowerShell 7）：
#   ./scripts/balance-all.ps1                        # 五個場地，每組 6 場
#   ./scripts/balance-all.ps1 -Games 10 -Arenas volcano,glacier
param(
  [int]$Games = 6,
  [string[]]$Arenas = @('practice', 'stadium', 'double', 'volcano', 'glacier', 'flooded')
)

Set-Location (Join-Path $PSScriptRoot '..')
New-Item -ItemType Directory -Force logs | Out-Null
$env:GAMES = "$Games"
foreach ($a in $Arenas) {
  $env:ARENA = $a
  # 只留報表本體（從 [場地] 那一行開始到空行為止）
  $out = npx vitest run --project balance --reporter=verbose 2>&1 | Out-String
  $m = [regex]::Match($out, '(?s)\[' + $a + '\].*?(?=\r?\n\s*\r?\n)')
  Set-Content -Path "logs/balance-$a.log" -Value $m.Value -Encoding utf8
}
Remove-Item Env:ARENA, Env:GAMES

foreach ($a in $Arenas) {
  $lines = Get-Content "logs/balance-$a.log"
  "== $a"
  $lines | Where-Object { $_ -match '每組|^\{' }
  $rates = $lines | Where-Object { $_ -match '%$' }
  $rates | Select-Object -First 3
  '...'
  $rates | Select-Object -Last 3
}
