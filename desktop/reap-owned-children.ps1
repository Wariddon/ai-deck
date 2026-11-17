$ErrorActionPreference = 'Stop'
$ownerPid = [int]$env:AI_DECK_EXITED_OWNER_PID
$began = [DateTime]::Parse($env:AI_DECK_OWNER_BEGAN_UTC).ToUniversalTime()
$ended = [DateTime]::Parse($env:AI_DECK_OWNER_ENDED_UTC).ToUniversalTime()
if ($ownerPid -le 0 -or $ended -lt $began) { exit 1 }
# A reused root PID makes ancestry ambiguous. Leave that tree alone.
if (Get-CimInstance Win32_Process -Filter "ProcessId=$ownerPid") { exit 0 }
$children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$ownerPid")
foreach ($child in $children) {
  $created = $child.CreationDate.ToUniversalTime()
  if ($created -lt $began -or $created -gt $ended) { continue }
  $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($child.ProcessId)"
  if (!$current -or $current.ParentProcessId -ne $ownerPid -or $current.CreationDate -ne $child.CreationDate) { continue }
  if (Get-CimInstance Win32_Process -Filter "ProcessId=$ownerPid") { exit 0 }
  & "$env:SystemRoot\System32\taskkill.exe" /PID $child.ProcessId /T /F *> $null
}
