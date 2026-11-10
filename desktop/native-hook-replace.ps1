param(
    [Parameter(Mandatory = $true)][string]$Temp,
    [Parameter(Mandatory = $true)][string]$Target,
    [Parameter(Mandatory = $true)][string]$Expected
)

$ErrorActionPreference = 'Stop'
$stream = [System.IO.File]::OpenRead($Target)
$sha = [System.Security.Cryptography.SHA256]::Create()
try {
    $actual = [System.BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '')
} finally {
    $stream.Dispose()
    $sha.Dispose()
}
if ($actual -ne $Expected) {
    exit 3
}
[System.IO.File]::Replace($Temp, $Target, [System.Management.Automation.Language.NullString]::Value)
