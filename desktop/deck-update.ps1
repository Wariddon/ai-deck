param([Parameter(Mandatory=$true)][string]$Receipt, [switch]$Apply)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
function Hash([string]$File) {
  $sha = [Security.Cryptography.SHA256]::Create(); $stream = [IO.File]::OpenRead($File)
  try { return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
  finally { $stream.Dispose(); $sha.Dispose() }
}
function CleanPath([string]$Value) {
  if (-not [IO.Path]::IsPathRooted($Value)) { throw 'Expected an absolute update path.' }
  $full = [IO.Path]::GetFullPath($Value).TrimEnd('\')
  $part = $full
  while ($part -and (Test-Path -LiteralPath $part)) {
    if ((Get-Item -LiteralPath $part -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked update paths are not supported.' }
    $part = [IO.Path]::GetDirectoryName($part)
  }
  return $full
}
$receiptPath = CleanPath $Receipt
$r = Get-Content -LiteralPath $receiptPath -Raw -Encoding UTF8 | ConvertFrom-Json
$root = CleanPath $r.root
$work = CleanPath $r.work
$archive = CleanPath $r.archive
if (-not [IO.Path]::GetDirectoryName($root) -or $root.Length -lt 5 -or $root -eq [Environment]::GetFolderPath('UserProfile') -or
    $root -eq $env:ProgramFiles -or $root -eq $env:SystemRoot) { throw 'Choose a dedicated portable application folder.' }
if ([IO.Path]::GetDirectoryName($work) -ne [IO.Path]::GetDirectoryName($root) -or [IO.Path]::GetDirectoryName($archive) -ne $work -or
    [IO.Path]::GetDirectoryName($receiptPath) -ne $work -or [IO.Path]::GetFileName($work) -notmatch '^\.ai-deck-update-[a-f0-9-]{36}$' -or
    $r.version -notmatch '^0\.9\.[1-9][0-9]{0,5}$' -or $r.sha256 -notmatch '^[a-f0-9]{64}$') { throw 'Update receipt paths are invalid.' }
$destination = Join-Path $work 'unpacked'
$newRoot = Join-Path $destination 'AI Deck'
function VerifyPayload {
  $appRoot = Join-Path $newRoot 'resources\app'
  $manifest = Get-Content -LiteralPath (Join-Path $appRoot 'release-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $pkg = Get-Content -LiteralPath (Join-Path $appRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($pkg.version -ne $r.version -or $manifest.version -ne $r.version -or $manifest.schema -ne 1) { throw 'Update version mismatch.' }
  $files = @(Get-ChildItem -LiteralPath $appRoot -Recurse -File)
  if ($files.Count -ne @($manifest.files).Count + 1) { throw 'Unexpected update payload files.' }
  foreach ($f in $manifest.files) {
    if ($f.path -match '(^/|\\|:|(^|/)\.\.(/|$))') { throw 'Invalid payload path.' }
    $file = Join-Path $appRoot $f.path
    if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or (Get-Item -LiteralPath $file).Length -ne $f.bytes -or (Hash $file) -ne $f.sha256) { throw 'Update payload hash mismatch.' }
  }
}
if (-not $Apply) {
  if ((Hash $archive) -ne $r.sha256) { throw 'Update archive hash mismatch.' }
  if (Test-Path -LiteralPath $destination) { throw 'Update was already unpacked.' }
  $zip = [IO.Compression.ZipFile]::OpenRead($archive)
  $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  [long]$total = 0
  try {
    foreach ($entry in $zip.Entries) {
      $name = $entry.FullName
      if ($name -notmatch '^AI Deck/' -or $name.Contains('\') -or $name.Contains(':') -or $name.Contains([char]0) -or
          $name -match '(^|/)\.{1,2}(/|$)|//|[ .](/|$)|(^|/)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|/|$)' -or
          -not $names.Add($name.TrimEnd('/')) -or (($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) { throw 'Unsafe update archive entry.' }
      $total += $entry.Length
      if ($total -gt 1500MB -or $zip.Entries.Count -gt 12000) { throw 'Update archive exceeds extraction limits.' }
    }
  } finally { $zip.Dispose() }
  [IO.Compression.ZipFile]::ExtractToDirectory($archive, $destination)
  VerifyPayload
  if (-not (Test-Path -LiteralPath (Join-Path $newRoot 'AI Deck.exe') -PathType Leaf)) { throw 'Update executable is missing.' }
  @{ready=$true;version=$r.version} | ConvertTo-Json -Compress
  exit
}
# Work from a trusted helper copied outside the installation before it quits.
try {
  $old = Get-Process -Id $r.pid -ErrorAction SilentlyContinue
  if ($old) {
    if ($old.Path -ne (Join-Path $root 'AI Deck.exe') -or $old.StartTime.ToUniversalTime().Ticks.ToString() -ne $r.started) { throw 'Update process identity changed.' }
    if (-not $old.WaitForExit(60000)) { throw 'AI Deck is still running. No files were replaced.' }
  }
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    $remaining = @(Get-Process -Name 'AI Deck' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq (Join-Path $root 'AI Deck.exe') })
    if (-not $remaining.Count) { break }
    Start-Sleep -Milliseconds 100
  }
  if ($remaining.Count) { throw 'Another AI Deck process is using this installation.' }
  VerifyPayload
  $backup = $root + '.previous-' + $r.version
  if (Test-Path -LiteralPath $backup) { throw 'An update backup already exists.' }
  # Managed tools stay machine-local. The profile is outside this portable folder.
  if (Test-Path -LiteralPath (Join-Path $root 'tools')) {
    if ((Get-Item -LiteralPath (Join-Path $root 'tools')).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked local tools cannot be moved.' }
    if (Test-Path -LiteralPath (Join-Path $newRoot 'tools')) { throw 'A release must not replace local tools.' }
  }
  Move-Item -LiteralPath $root -Destination $backup
  try {
    Move-Item -LiteralPath $newRoot -Destination $root
    if (Test-Path -LiteralPath (Join-Path $backup 'tools')) { Move-Item -LiteralPath (Join-Path $backup 'tools') -Destination (Join-Path $root 'tools') }
    $voice = Join-Path $backup 'resources\app\voice-tools'
    if ((Test-Path -LiteralPath $voice) -and -not (Test-Path -LiteralPath (Join-Path $root 'resources\app\voice-tools'))) {
      Copy-Item -LiteralPath $voice -Destination (Join-Path $root 'resources\app\voice-tools') -Recurse
    }
    Start-Process -FilePath (Join-Path $root 'AI Deck.exe') -WorkingDirectory $root -WindowStyle Hidden
    @{installed=$true;version=$r.version;backup=$backup} | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $work 'result.json') -Encoding UTF8
  } catch {
    if ((Test-Path -LiteralPath (Join-Path $root 'tools')) -and -not (Test-Path -LiteralPath (Join-Path $backup 'tools'))) {
      Move-Item -LiteralPath (Join-Path $root 'tools') -Destination (Join-Path $backup 'tools')
    }
    if (Test-Path -LiteralPath $root) { Move-Item -LiteralPath $root -Destination (Join-Path $work 'failed') }
    Move-Item -LiteralPath $backup -Destination $root
    throw
  }
} catch {
  @{installed=$false;error=$_.Exception.Message} | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $work 'result.json') -Encoding UTF8
  if (Test-Path -LiteralPath (Join-Path $root 'AI Deck.exe')) { Start-Process -FilePath (Join-Path $root 'AI Deck.exe') -WorkingDirectory $root -WindowStyle Hidden }
  exit 1
}
