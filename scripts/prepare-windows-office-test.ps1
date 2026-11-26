$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'This test configures document associations on a disposable hosted Windows runner.'
}
$msi = Join-Path $env:RUNNER_TEMP 'libreoffice-x64.msi'
$packagePath = 'libreoffice/stable/26.8.3/win/x86_64/LibreOffice_26.8.3_Win_x86-64.msi'
$verified = $false
foreach ($base in 'https://download.documentfoundation.org', 'https://mirror.fcix.net/tdf', 'https://tdf.mirror.rafal.ca') {
    Write-Host "Downloading LibreOffice from $base"
    curl.exe --fail --location --silent --show-error --connect-timeout 15 --max-time 180 --output $msi "$base/$packagePath"
    if ($LASTEXITCODE -eq 0 -and (Get-FileHash $msi).Hash -eq '0e6918c273eabbdbbd800ee0dacbbf130a14c13c2e4cec861b06dd59e015bf94') {
        $verified = $true
        break
    }
}
if (!$verified) {
    throw 'LibreOffice installer download or SHA-256 check failed.'
}
Write-Host 'Installing the verified LibreOffice MSI'
$install = Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qn /norestart REGISTER_ALL_MSO_TYPES=1" -PassThru
if (!$install.WaitForExit(300000)) { throw 'LibreOffice MSI installation exceeded five minutes.' }
if ($install.ExitCode -notin 0, 3010) { throw "LibreOffice installation failed: $($install.ExitCode)" }
$program = Join-Path $env:ProgramFiles 'LibreOffice\program'
if (!(Test-Path "$program\python.exe")) { throw 'LibreOffice Python is required for the native save check.' }
# Use LibreOffice's installed document handlers on this clean test account.
foreach ($entry in @{'.xlsx'='LibreOffice.Xlsx'; '.pptx'='LibreOffice.Pptx'}.GetEnumerator()) {
    $command = Get-Item "Registry::HKEY_CLASSES_ROOT\$($entry.Value)\shell\open\command"
    Write-Host "$($entry.Key) document handler: $($command.GetValue(''))"
    $key = New-Item "HKCU:\Software\Classes\$($entry.Key)" -Force
    Set-Item -LiteralPath $key.PSPath -Value $entry.Value
}
$pipe = 'DynoteOffice' + [Guid]::NewGuid().ToString('N')
Start-Process "$program\soffice.exe" -ArgumentList "--nodefault --nologo --norestore --accept=pipe,name=$pipe;urp;"
"DYNOTE_OFFICE_PIPE=$pipe" >> $env:GITHUB_ENV
