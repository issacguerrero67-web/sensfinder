; Inno Setup script. Built by packaging\build.ps1:  iscc /DAppVersion=1.0.0 packaging\sensfinder.iss
; Per-user install (no admin prompt). Unsigned for now: SmartScreen shows "More info" -> "Run anyway".
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{6B7C0C52-6E0B-4B36-9F5B-5E4F5A1D7C11}
AppName=Sensfinder
AppVersion={#AppVersion}
AppPublisher=Issac Guerrero
DefaultDirName={localappdata}\Programs\Sensfinder
DefaultGroupName=Sensfinder
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\release
OutputBaseFilename=Sensfinder-{#AppVersion}-setup
SetupIconFile=icon.ico
UninstallDisplayIcon={app}\Sensfinder.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked

[Files]
Source: "..\dist\Sensfinder\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{group}\Sensfinder"; Filename: "{app}\Sensfinder.exe"
Name: "{autodesktop}\Sensfinder"; Filename: "{app}\Sensfinder.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Sensfinder.exe"; Description: "Start Sensfinder"; Flags: nowait postinstall skipifsilent

; Your data lives in %LOCALAPPDATA%\Sensfinder\data and is left alone on uninstall.
