param([Parameter(Mandatory)][string]$From,[Parameter(Mandatory)][string]$Label)
$ErrorActionPreference = 'Stop'
$adbPath = 'C:\Users\Owner\AppData\Local\Android\Sdk\platform-tools\adb.exe'
$activity = & $adbPath -s emulator-5554 shell dumpsys activity activities
if (($activity | Select-String 'mResumedActivity') -notmatch 'com.spragginsdesigns.sureword') { throw 'SureWord is not the resumed app.' }
[xml]$tree = Get-Content -LiteralPath (Join-Path $PSScriptRoot "$From.xml")
$nodes = @($tree.SelectNodes('//node') | Where-Object { $_.'content-desc' -eq $Label })
if (!$nodes.Count) { $nodes = @($tree.SelectNodes('//node') | Where-Object { $_.text -eq $Label }) }
foreach ($node in $nodes) {
    if ($node.bounds -match '^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$') {
        $x1=[int]$Matches[1]; $y1=[int]$Matches[2]; $x2=[int]$Matches[3]; $y2=[int]$Matches[4]
        if ($x2 -le $x1 -or $y2 -le $y1) { continue }
        & $adbPath -s emulator-5554 shell input tap ([int](($x1+$x2)/2)) ([int](($y1+$y2)/2))
        Write-Output "Tapped $Label in $($node.bounds)"
        exit 0
    }
}
throw "No visible UI-tree target: $Label"
