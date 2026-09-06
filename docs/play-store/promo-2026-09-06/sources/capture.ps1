param([Parameter(Mandatory)][string]$Name, [switch]$Screenshot)
$ErrorActionPreference = 'Stop'
$adbPath = 'C:\Users\Owner\AppData\Local\Android\Sdk\platform-tools\adb.exe'
$artifactDir = $PSScriptRoot
$remoteXml = "/sdcard/sureword-$Name.xml"
$dumpResult = & $adbPath -s emulator-5554 shell uiautomator dump --compressed $remoteXml 2>&1
if (($dumpResult -join ' ') -notmatch 'dumped to:') { throw ($dumpResult -join ' ') }
& $adbPath -s emulator-5554 pull $remoteXml "$artifactDir/$Name.xml" | Out-Null
[xml]$tree = Get-Content -LiteralPath "$artifactDir/$Name.xml"
$tree.SelectNodes('//node') | Where-Object { $_.text -or $_.'content-desc' -or $_.class -match 'EditText|WebView' } | ForEach-Object {
    $label = if ($_.'content-desc') { $_.'content-desc' } else { $_.text }
    if ($label.Length -gt 110) { $label = $label.Substring(0,110) }
    '{0} | {1} | {2} | selected={3}' -f $label.Replace("`n",' '),$_.bounds,$_.class,$_.selected
}
if ($Screenshot) {
    & $adbPath -s emulator-5554 shell screencap -p "/sdcard/sureword-$Name.png"
    & $adbPath -s emulator-5554 pull "/sdcard/sureword-$Name.png" "$artifactDir/$Name.png" | Out-Null
}
