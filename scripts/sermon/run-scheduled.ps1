<#
.SYNOPSIS
  Scheduled entry point for the sermon pipeline. Task Scheduler runs this.

.DESCRIPTION
  Starts shortly after a Sunday or Wednesday service ends and keeps polling
  until that service has a study on SureWord, then stops. Along the way it also
  picks up any other recent service that was missed (Sunday School is skipped).
  Safe to run at any time: with nothing to do it exits in seconds.

  Polling is the point. For an hour or more after a stream ends, YouTube only
  offers a live-DVR manifest and the download fails or crawls; ingest.mjs exits
  75 for that, and for "today's service is not on the channel yet", and this
  loop waits and tries again rather than giving up the way a single run would.

  This has to run here rather than on Vercel. YouTube answers datacenter
  ranges with "Sign in to confirm you're not a bot" (verified against the
  LineCrush VPS on 2026-09-20), transcription wants the GPU, and a 76 minute
  service is far past the function budget. If this machine stops running it,
  the /api/cron/sermon-watchdog push notification says so within four days.

  Exit codes:
    0   today's service (if any) has a study, and nothing else is pending
    1   the pipeline failed repeatedly; see the log
    2   still waiting on YouTube when the polling window closed

.PARAMETER SkipUpdate
  Skip the yt-dlp self-update. The update is on by default because a stale
  yt-dlp is the single most likely way this breaks: YouTube changes its player
  every few weeks and a stale binary fails as a 403 or a silent stall.

.PARAMETER MaxHours
  How long to keep polling for today's service before giving up.

.PARAMETER RetryMinutes
  Wait between attempts while YouTube is still processing the stream.

.EXAMPLE
  Register the Sunday and Wednesday task (once):
    powershell -ExecutionPolicy Bypass -File scripts\sermon\register-task.ps1
#>
[CmdletBinding()]
param(
    [switch]$SkipUpdate,
    [double]$MaxHours = 4,
    [int]$RetryMinutes = 10
)

$ErrorActionPreference = "Stop"

# Windows 11 puts a windowless background process in efficiency mode (EcoQoS),
# and the task runs headless. Measured on 2026-09-27: a 3-minute clip took 177s
# to transcribe from the task and 19s once opted out, the same as a terminal.
# Children (node, python, yt-dlp) inherit the opt-out.
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class SermonEcoQos {
    [StructLayout(LayoutKind.Sequential)]
    struct PowerThrottlingState { public uint Version; public uint ControlMask; public uint StateMask; }
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetProcessInformation(IntPtr process, int infoClass, ref PowerThrottlingState info, int size);
    [DllImport("kernel32.dll")]
    static extern IntPtr GetCurrentProcess();
    public static bool OptOut() {
        // ProcessPowerThrottling (4): control EXECUTION_SPEED, state off.
        var state = new PowerThrottlingState { Version = 1, ControlMask = 1, StateMask = 0 };
        return SetProcessInformation(GetCurrentProcess(), 4, ref state, Marshal.SizeOf(typeof(PowerThrottlingState)));
    }
}
"@
$ecoQosOptOut = [SermonEcoQos]::OptOut()

$repo =Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$logDir = Join-Path $repo "artifacts\sermons"
$logFile = Join-Path $logDir "scheduled.log"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-Log([string]$message) {
    $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message
    Write-Host $line
    # Anything reading the log (a `tail -f`, an editor) can hold it open, and
    # Add-Content then fails; a run's whole log went missing that way once.
    for ($i = 0; $i -lt 5; $i++) {
        try {
            Add-Content -Path $logFile -Value $line -ErrorAction Stop
            return
        } catch {
            Start-Sleep -Milliseconds 200
        }
    }
}

# Task Scheduler hands the task the environment captured at sign-in, so rebuild
# PATH from the registry to pick up anything installed since.
$env:Path = @(
    [Environment]::GetEnvironmentVariable("Path", "Machine"),
    [Environment]::GetEnvironmentVariable("Path", "User")
) -join ";"

# Transcription decodes through ffmpeg. winget installs it under a versioned
# folder and an upgrade leaves PATH pointing at the old, deleted one (it did on
# 2026-09-27, killing a run with "ffmpeg not found"), so find it directly.
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    $ffmpeg = Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\*FFmpeg*" `
        -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($ffmpeg) { $env:Path = "$($ffmpeg.DirectoryName);$env:Path" }
}

# Keep the log from growing without bound.
if ((Test-Path $logFile) -and ((Get-Item $logFile).Length -gt 1MB)) {
    Move-Item -Force $logFile "$logFile.1"
}

# FMBC streams Sunday morning and Wednesday evening. On those days the run is
# not done until that day's service has a study; any other day it just sweeps
# up anything recent that was missed.
$today = Get-Date
$expectDate = $null
if ($today.DayOfWeek -in @([DayOfWeek]::Sunday, [DayOfWeek]::Wednesday)) {
    $expectDate = $today.ToString("yyyy-MM-dd")
}
Write-Log ("run starting" + $(if ($expectDate) { ", waiting for the $expectDate service" } else { "" }))
if (-not $ecoQosOptOut) { Write-Log "warning: could not opt out of efficiency mode; transcription may be ~10x slower" }

if (-not $SkipUpdate) {
    # Not fatal either way: the installed binary may still work fine. The
    # timeout matters: a stalled update check once held a run for 5+ minutes
    # with no end in sight.
    $updateLog = Join-Path $env:TEMP "sureword-ytdlp-update.log"
    try {
        $update = Start-Process yt-dlp -ArgumentList "-U" -NoNewWindow -PassThru `
            -RedirectStandardOutput $updateLog -RedirectStandardError "$updateLog.err"
        if ($update.WaitForExit(120000)) {
            Write-Log "yt-dlp: $(Get-Content $updateLog -ErrorAction SilentlyContinue | Select-Object -Last 1)"
        } else {
            Get-CimInstance Win32_Process -Filter "ParentProcessId=$($update.Id)" |
                ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
            Stop-Process -Id $update.Id -Force -ErrorAction SilentlyContinue
            Write-Log "yt-dlp update timed out after 2 min; continuing with the installed version"
        }
    } catch {
        Write-Log "yt-dlp update skipped: $($_.Exception.Message)"
    }
}

$ingestArgs = @("scripts\sermon\ingest.mjs", "--latest", "--publish")
if ($expectDate) { $ingestArgs += @("--expect-date", $expectDate) }

$deadline = (Get-Date).AddHours($MaxHours)
$failures = 0
$published = 0

Push-Location $repo
try {
    while ($true) {
        $output = @()
        # node writes progress to stderr too; keep it in the log, not as an error.
        $ErrorActionPreference = "Continue"
        & node @ingestArgs 2>&1 | ForEach-Object {
            # A stderr line arrives as an ErrorRecord whose text is the target
            # object; stringifying the record prints "RemoteException" instead.
            $line = if ($_ -is [System.Management.Automation.ErrorRecord]) { "$($_.TargetObject)" } else { "$_" }
            if (-not $line.Trim()) { return }
            $output += $line
            Write-Log $line
        }
        $code = $LASTEXITCODE
        $ErrorActionPreference = "Stop"

        if ($code -eq 0) {
            if ($output -match "nothing new on the channel") {
                Write-Log "run finished, $published published"
                exit 0
            }
            # Published one; go straight round in case another is pending.
            $published += 1
            $failures = 0
            continue
        }

        if ($code -eq 75) {
            Write-Log "waiting on YouTube"
        } else {
            $failures += 1
            Write-Log "attempt FAILED with exit code $code ($failures of 3)"
            if ($failures -ge 3) {
                Write-Log "run FAILED, giving up"
                exit 1
            }
        }

        if ((Get-Date).AddMinutes($RetryMinutes) -gt $deadline) {
            Write-Log "polling window closed after $MaxHours h, $published published; still waiting on YouTube"
            exit 2
        }
        Write-Log "retrying in $RetryMinutes min"
        Start-Sleep -Seconds ($RetryMinutes * 60)
    }
} finally {
    Pop-Location
}
