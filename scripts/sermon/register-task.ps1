<#
.SYNOPSIS
  Registers (or re-registers) the "SureWord sermon study" scheduled task.

.DESCRIPTION
  FMBC's Sunday service goes live about 10:40 AM and runs 75 to 95 minutes;
  Wednesday goes live about 6:50 PM and runs 35 to 75. The triggers sit just
  after the usual end, and run-scheduled.ps1 polls from there until YouTube has
  processed the stream and the study is published.

  The task runs hidden (no console window) and as the signed-in user, which is
  what gives it the GPU, the .env.local in the repo, and yt-dlp on PATH.
  StartWhenAvailable runs a missed trigger as soon as the PC is back on, and
  WakeToRun wakes it from sleep (wake timers are enabled on AC power).
#>
$ErrorActionPreference = "Stop"

$taskName = "SureWord sermon study"
$script = Join-Path $PSScriptRoot "run-scheduled.ps1"

$action = New-ScheduledTaskAction -Execute "conhost.exe" `
    -Argument "--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$script`""

$sunday = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At "12:10PM"
$wednesday = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Wednesday -At "7:40PM"

# Priority 4 is normal. Task Scheduler's default of 7 also lowers I/O priority,
# and on a busy PC that stretched a 2-minute transcription to 16 and made every
# process launch take a minute or more.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Priority 4 `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 5)

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive

Register-ScheduledTask -TaskName $taskName -Force `
    -Action $action -Trigger $sunday, $wednesday -Settings $settings -Principal $principal `
    -Description "Builds a guided study from each FMBC Sunday and Wednesday service and publishes it to SureWord. See scripts/sermon/run-scheduled.ps1." |
    Out-Null

Get-ScheduledTask -TaskName $taskName | Get-ScheduledTaskInfo |
    Format-List TaskName, NextRunTime, LastRunTime, LastTaskResult
