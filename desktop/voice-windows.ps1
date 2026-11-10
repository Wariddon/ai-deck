param(
  [Parameter(Mandatory)][string]$InputFile,
  [Parameter(Mandatory)][string]$OutputFile
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$synthesizer = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType=WindowsRuntime]::new()
$streamType = [Windows.Media.SpeechSynthesis.SpeechSynthesisStream, Windows.Media.SpeechSynthesis, ContentType=WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
$text = [IO.File]::ReadAllText($InputFile)
$locale = if ($text -match '[\u0E00-\u0E7F]') { 'th' } else { 'en' }
$voice = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object {
  $_.Language -like "$locale-*"
} | Select-Object -First 1
if (!$voice) {
  [Console]::Error.WriteLine("No $locale voice is installed in Windows.")
  exit 3
}
$synthesizer.Voice = $voice
$operation = $synthesizer.SynthesizeTextToStreamAsync($text)
$task = $asTask.MakeGenericMethod($streamType).Invoke($null, @($operation))
$wave = $task.GetAwaiter().GetResult()
$inputStream = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($wave)
$outputStream = [IO.File]::Create($OutputFile)
try { $inputStream.CopyTo($outputStream) }
finally {
  $outputStream.Dispose()
  $inputStream.Dispose()
  $synthesizer.Dispose()
}
