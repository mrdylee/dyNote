[Setup]
AppId={{FFECFC28-FC48-449A-8E3F-3D6E554E38E1}
AppName=Dynote
AppVersion={#AppVersion}
AppPublisher=Dynote contributors
DefaultDirName={localappdata}\Programs\Dynote
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
OutputBaseFilename=Dynote-{#AppVersion}-windows-x64-Setup
SetupIconFile=..\branding\dynote.ico
UninstallDisplayIcon={app}\Dynote.exe
RestartApplications=no
Compression=lzma2
SolidCompression=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; Flags: unchecked

[Files]
Source: "{#PackageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "dynote-installed"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{userprograms}\Dynote"; Filename: "{app}\Dynote.exe"; WorkingDir: "{app}"
Name: "{userdesktop}\Dynote"; Filename: "{app}\Dynote.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\Dynote.exe"; Description: "{cm:LaunchProgram,Dynote}"; Flags: nowait postinstall skipifsilent
