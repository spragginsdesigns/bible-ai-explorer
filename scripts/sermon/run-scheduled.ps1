<#
.SYNOPSIS
  Scheduled entry point for the sermon pipeline. Task Scheduler runs this.

.DESCRIPTION
  Discovers the newest service on the channel, and if it has not been built
  yet, downloads it, transcribes it on the GPU and publishes the study to
  SureWord. Safe to run at any time and as often as you like: it exits without
  doing anything when there is nothing new.

  This has to run here rather than on Vercel. YouTube answers datacenter
  ranges with "Sign in to confirm you're not a bot" (verified against the
  LineCrush VPS on 2026-09-20), transcription wants the GPU, and a 76 minute
  service is far past the function budget.

  Exit codes:
    0   a study was built, or there was nothing new to build
    75  YouTube has not finished turning the stream into a VOD yet. Normal for
        a couple of hours after a service ends. Task Scheduler should retry.
    1   something actually failed

.PARAMETER SkipUpdate
  Skip the yt-dlp self-update. The update is on by default because a stale
  yt-dlp is the single most likely way this breaks: YouTube changes its player
  every few weeks and a stale binary fails as a 403 or a silent stall.

.EXAMPLE
  Register both services (run once, as Austin, from an elevated shell):

  $ps = "powershell.exe"
  $script = "$HOME\Documents\Github_Repositories\bible-ai-explorer\scripts\sermon\run-scheduled.ps1"
  $action = New-ScheduledTaskAction -Execute $ps `
      -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
  # Sunday afternoon and Wednesday night, both well after the service ends so
  # YouTube has finished processing the VOD.
  $sunday = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 15:00
  $wednesday = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Wednesday -At 23:00
  # StartWhenAvailable is the setting that matters: it runs the task as soon as
  # the machine is back if it was off or asleep at the scheduled time.
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
      -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 30) `
      -ExecutionTimeLimit (New-TimeSpan -Hours 2) -WakeToRun
  Register-ScheduledTask -TaskName "SureWord sermon study" `
      -Action $action -Trigger $sunday, $wednesday -Settings $settings `
      -Description "Builds a guided study from the newest FMBC service and publishes it to SureWord."
#>
[CmdletBinding()]
param(
    [switch]$SkipUpdate
)

$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$logDir = Join-Path $repo "artifacts\sermons"
$logFile = Join-Path $logDir "scheduled.log"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-Log([string]$message) {
    $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message
    Write-Host $line
    Add-Content -Path $logFile -Value $line
}

# Keep the log from growing without bound; a run is a handful of lines.
if ((Test-Path $logFile) -and ((Get-Item $logFile).Length -gt 1MB)) {
    Move-Item -Force $logFile "$logFile.1"
}

Write-Log "run starting"

if (-not $SkipUpdate) {
    try {
        $update = (& yt-dlp -U 2>&1 | Select-Object -Last 1)
        Write-Log "yt-dlp: $update"
    } catch {
        # Not fatal: the installed binary may still work fine.
        Write-Log "yt-dlp update skipped: $($_.Exception.Message)"
    }
}

Push-Location $repo
try {
    & node "scripts\sermon\ingest.mjs" --latest --publish 2>&1 | ForEach-Object { Write-Log $_ }
    $code = $LASTEXITCODE
} finally {
    Pop-Location
}

switch ($code) {
    0  { Write-Log "run finished" }
    75 { Write-Log "stream not processed by YouTube yet; Task Scheduler will retry" }
    default { Write-Log "run FAILED with exit code $code" }
}

exit $code
