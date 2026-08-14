# ============================================================
# OMEGA Watchdog — 7/24 Guardian for Autonomous Outreach System
# ============================================================
# This script runs every 5 minutes via Windows Task Scheduler.
# It checks if PM2 is running and the server is responsive.
# If not, it automatically revives the entire stack.
# ============================================================

# Set UTF-8 encoding for proper log output
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$PSDefaultParameterValues['Out-File:Encoding'] = 'utf8'

$logFile = "$PSScriptRoot\data\logs\watchdog.log"
$backendDir = $PSScriptRoot

function Write-WatchdogLog {
    param([string]$Message)
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts] $Message"
    Write-Host $line
    
    # Ensure log directory exists
    $logDir = Split-Path $logFile -Parent
    if (!(Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
    
    # Use UTF-8 encoding for log file
    Add-Content -Path $logFile -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
}

function Test-ServerAlive {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:3002/api/stats" -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
        return ($response.StatusCode -eq 200)
    } catch {
        return $false
    }
}

function Test-PM2Running {
    $pm2Process = Get-Process -Name "pm2" -ErrorAction SilentlyContinue
    if ($pm2Process) { return $true }
    
    # Also check if our app is in PM2's process list
    try {
        $pm2List = & pm2 jlist 2>$null | ConvertFrom-Json
        foreach ($proc in $pm2List) {
            if ($proc.name -eq "autonomous-outreach" -and $proc.pm2_env.status -eq "online") {
                return $true
            }
        }
    } catch {}
    
    return $false
}

# === MAIN WATCHDOG LOGIC ===

Write-WatchdogLog "WATCHDOG CHECK starting..."

# Step 1: Is the server responding?
$serverAlive = Test-ServerAlive

if ($serverAlive) {
    Write-WatchdogLog "OK: Server is alive and responding on port 3002."
    
    # Trim log file if it gets too large (>5MB)
    if ((Test-Path $logFile) -and ((Get-Item $logFile).Length -gt 5MB)) {
        $lines = Get-Content $logFile -Tail 500
        Set-Content $logFile $lines
        Write-WatchdogLog "LOG: Trimmed watchdog log to last 500 lines."
    }
    exit 0
}

Write-WatchdogLog "WARNING: Server NOT responding. Initiating recovery..."

# Step 2: Is PM2 managing our app?
$pm2Running = Test-PM2Running

if ($pm2Running) {
    Write-WatchdogLog "RECOVERY: PM2 is running but server is unresponsive. Restarting app..."
    Set-Location $backendDir
    & pm2 restart autonomous-outreach --update-env 2>&1 | ForEach-Object { Write-WatchdogLog "PM2: $_" }
} else {
    Write-WatchdogLog "RECOVERY: PM2 is NOT running. Starting full stack..."
    
    # Kill any zombie node processes on our port
    $portUsers = netstat -ano | findstr ":3002" | findstr "LISTENING"
    foreach ($line in $portUsers) {
        $parts = $line.Trim() -split "\s+"
        $pid = $parts[-1]
        if ($pid -match "^\d+$") {
            Write-WatchdogLog "CLEANUP: Killing zombie process PID $pid on port 3002"
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        }
    }
    
    Start-Sleep -Seconds 2
    
    # Start PM2 with our ecosystem config
    Set-Location $backendDir
    & pm2 start ecosystem.config.cjs 2>&1 | ForEach-Object { Write-WatchdogLog "PM2: $_" }
    & pm2 save 2>&1 | ForEach-Object { Write-WatchdogLog "PM2: $_" }
}

# Step 3: Wait and verify recovery
Start-Sleep -Seconds 15
$recoveryCheck = Test-ServerAlive

if ($recoveryCheck) {
    Write-WatchdogLog "RECOVERY SUCCESS: Server is back online!"
} else {
    Write-WatchdogLog "RECOVERY FAILED: Server still not responding after restart. Manual intervention may be needed."
}

Write-WatchdogLog "WATCHDOG CHECK complete."
