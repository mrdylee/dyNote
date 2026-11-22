$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'This test configures document associations on a disposable hosted Windows runner.'
}
$msi = Join-Path $env:RUNNER_TEMP 'libreoffice-x64.msi'
$url = 'https://download.documentfoundation.org/libreoffice/stable/26.8.3/win/x86_64/LibreOffice_26.8.3_Win_x86-64.msi'
curl.exe --fail --location --silent --show-error --retry 3 --output $msi $url
if ($LASTEXITCODE -ne 0 -or (Get-FileHash $msi).Hash -ne '0e6918c273eabbdbbd800ee0dacbbf130a14c13c2e4cec861b06dd59e015bf94') {
    throw 'LibreOffice installer download or SHA-256 check failed.'
}
$install = Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qn /norestart REGISTER_ALL_MSO_TYPES=1" -Wait -PassThru
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
