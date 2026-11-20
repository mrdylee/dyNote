param([Parameter(Mandatory=$true)][string]$JobPath)
$ErrorActionPreference = 'Stop'
$jobDirectory = Split-Path -Parent $JobPath
$job = Get-Content -LiteralPath $JobPath -Raw -Encoding UTF8 | ConvertFrom-Json
$relaunch = $false
try {
    # Capture the parent before acknowledging startup. Never terminate it to install.
    $parent = Get-Process -Id $job.parentPid -ErrorAction SilentlyContinue
    Set-Content -LiteralPath (Join-Path $jobDirectory 'ready') -Value 'ready'
    if ($parent -and !$parent.WaitForExit(120000)) { throw 'Dynote did not finish saving and exit.' }
    if (Test-Path -LiteralPath (Join-Path $jobDirectory 'cancel')) { exit 1 }
    $relaunch = $true
    if ((Get-FileHash -LiteralPath $job.installer -Algorithm SHA256).Hash -ne $job.sha256) { throw 'Installer SHA256 verification failed.' }
    $installDirectory = Split-Path -Parent $job.executable
    $log = Join-Path $jobDirectory 'setup.log'
    $arguments = @('/SP-', '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/NOCLOSEAPPLICATIONS', '/NORESTARTAPPLICATIONS', '/RESTARTEXITCODE=3010', ('/DIR="' + $installDirectory + '"'), ('/LOG="' + $log + '"'))
    $setup = Start-Process -FilePath $job.installer -ArgumentList $arguments -Wait -PassThru
    if ($setup.ExitCode -ne 0) { throw ('Setup exit code: ' + $setup.ExitCode + '. See ' + $log) }
    @{ tag=$job.tag; installed=$true } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $jobDirectory 'result.json') -Encoding UTF8
} catch {
    @{ tag=$job.tag; installed=$false; error=$_.Exception.Message } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $jobDirectory 'result.json') -Encoding UTF8
} finally {
    if ($relaunch) { Start-Process -FilePath $job.executable -WorkingDirectory (Split-Path -Parent $job.executable) }
}
