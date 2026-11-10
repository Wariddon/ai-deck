$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

function Finish($data) {
  [Console]::WriteLine(($data | ConvertTo-Json -Compress -Depth 5))
  exit
}

function Get-Stamp([string]$value) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($value))).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose() }
}

function Get-ChromeView($root) {
  $scope = [Windows.Automation.TreeScope]::Descendants
  $property = [Windows.Automation.AutomationElement]::ControlTypeProperty
  $document = $root.FindFirst($scope, [Windows.Automation.PropertyCondition]::new($property, [Windows.Automation.ControlType]::Document))
  if ($document -and !$document.Current.IsOffscreen) {
    $value = $null
    $url = if ($document.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern, [ref]$value)) { $value.Current.Value }
    return Get-Stamp ("document|" + ($document.GetRuntimeId() -join '.') + "|" + $url)
  }
  $tabClass = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ClassNameProperty, 'Tab')
  $tabType = [Windows.Automation.PropertyCondition]::new($property, [Windows.Automation.ControlType]::TabItem)
  foreach ($tab in $root.FindAll($scope, [Windows.Automation.AndCondition]::new($tabClass, $tabType))) {
    $selection = $null
    if ($tab.TryGetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selection) -and $selection.Current.IsSelected) {
      return Get-Stamp ("tab|" + ($tab.GetRuntimeId() -join '.'))
    }
  }
}

function Get-ChromeImage([IntPtr]$handle, [int]$maxWidth, [int]$maxHeight) {
  Add-Type -AssemblyName System.Drawing
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DeckWindowImage {
  [StructLayout(LayoutKind.Sequential)] public struct Bounds { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr handle, out Bounds bounds);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr handle);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr handle, IntPtr context, uint flags);
}
'@
  $bounds = [DeckWindowImage+Bounds]::new()
  if ([DeckWindowImage]::IsIconic($handle) -or ![DeckWindowImage]::GetWindowRect($handle, [ref]$bounds)) {
    throw 'Restore the selected Chrome window.'
  }
  $width = $bounds.Right - $bounds.Left
  $height = $bounds.Bottom - $bounds.Top
  if ($width -lt 2 -or $height -lt 2 -or ([long]$width * $height) -gt 25000000) { throw 'Unsupported window size.' }
  $bitmap = [Drawing.Bitmap]::new($width, $height)
  try {
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
      $context = $graphics.GetHdc()
      try { $captured = [DeckWindowImage]::PrintWindow($handle, $context, 2) }
      finally { $graphics.ReleaseHdc($context) }
    } finally { $graphics.Dispose() }
    if (!$captured) { throw 'Chrome did not return a frame.' }
    $scale = [Math]::Min(1, [Math]::Min($maxWidth / $width, $maxHeight / $height))
    $scaled = [Drawing.Bitmap]::new($bitmap, [Math]::Max(1, [int]($width * $scale)), [Math]::Max(1, [int]($height * $scale)))
    try {
      $stream = [IO.MemoryStream]::new()
      try {
        $scaled.Save($stream, [Drawing.Imaging.ImageFormat]::Jpeg)
        if ($stream.Length -gt 1MB) { throw 'Chrome frame exceeded the image limit.' }
        [Convert]::ToBase64String($stream.ToArray())
      } finally { $stream.Dispose() }
    } finally { $scaled.Dispose() }
  } finally { $bitmap.Dispose() }
}

try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
  $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new([long]$request.handle))
  if (!$root -or $root.Current.IsOffscreen) { Finish @{ error = 'Restore the selected window and try again.' } }
  $processId = $root.Current.ProcessId
  $process = Get-Process -Id $processId
  $started = $process.StartTime.ToUniversalTime().Ticks.ToString()
  $identity = "$processId/$started"
  if ($request.identity -and $identity -ne $request.identity) { Finish @{ error = 'The selected window changed.' } }
  $application = $process.ProcessName
  $view = if ($application -eq 'chrome') { Get-ChromeView $root }
  if ($request.view -and $view -ne $request.view) { Finish @{ error = 'The selected Chrome tab or page changed. Inspect it again.' } }
  if ($request.action -eq 'identify') { Finish @{ identity = $identity; application = $application; view = $view } }
  if ($request.action -eq 'capture') {
    if ($application -ne 'chrome' -or !$request.identity -or !$view) { Finish @{ error = 'Chrome window identity could not be verified.' } }
    $width = [Math]::Min(1280, [Math]::Max(128, [int]$request.width))
    $height = [Math]::Min(800, [Math]::Max(128, [int]$request.height))
    $jpeg = Get-ChromeImage ([IntPtr]::new([long]$request.handle)) $width $height
    if ((Get-ChromeView $root) -ne $view) { Finish @{ error = 'The selected Chrome tab or page changed. Inspect it again.' } }
    Finish @{ jpeg = $jpeg }
  }
  if ($request.action -eq 'navigate') {
    $url = $null
    if ($application -ne 'chrome' -or ![Uri]::TryCreate([string]$request.url, [UriKind]::Absolute, [ref]$url) -or
        $url.Scheme -notin @('http', 'https') -or $url.UserInfo) { Finish @{ error = 'Choose an HTTP or HTTPS URL in the shared Chrome window.' } }
    $condition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ClassNameProperty, 'OmniboxViewViews')
    $address = $root.FindFirst([Windows.Automation.TreeScope]::Descendants, $condition)
    $value = $null
    if (!$address -or $address.Current.ProcessId -ne $processId -or !$address.Current.IsEnabled -or
        !$address.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern, [ref]$value) -or $value.Current.IsReadOnly) {
      Finish @{ error = 'Chrome did not expose its address bar.' }
    }
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DeckChromeFocus {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
}
'@
    $handle = [IntPtr]::new([long]$request.handle)
    [void][DeckChromeFocus]::SetForegroundWindow($handle)
    if ([DeckChromeFocus]::GetForegroundWindow() -ne $handle) { Finish @{ error = 'Bring the shared Chrome window to the front and try again.' } }
    $address.SetFocus()
    if ([DeckChromeFocus]::GetForegroundWindow() -ne $handle -or !$address.Current.HasKeyboardFocus) {
      Finish @{ error = 'Could not focus the shared Chrome address bar.' }
    }
    if ($request.view -and (Get-ChromeView $root) -ne $request.view) {
      Finish @{ error = 'The selected Chrome tab or page changed. Inspect it again.' }
    }
    $value.SetValue($url.AbsoluteUri)
    if ([DeckChromeFocus]::GetForegroundWindow() -ne $handle -or !$address.Current.HasKeyboardFocus) {
      Finish @{ error = 'Chrome focus changed before opening the URL.' }
    }
    [Windows.Forms.SendKeys]::SendWait('{ENTER}')
    Finish @{ applied = $true }
  }

  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $nodes = [Collections.Generic.Queue[object]]::new()
  $nodes.Enqueue($root)
  $controls = [Collections.Generic.List[object]]::new()
  $visited = 0
  while ($nodes.Count -gt 0 -and $visited -lt 180 -and $controls.Count -lt 36) {
    $element = $nodes.Dequeue()
    $visited++
    try {
      $properties = $element.Current
      if ($properties.ProcessId -ne $processId -or $properties.IsOffscreen -or $properties.IsPassword) { continue }
      $name = $properties.Name
      $kind = $properties.ControlType.ProgrammaticName.Replace('ControlType.', '')
      $invokePattern = $null
      $valuePattern = $null
      $canInvoke = $properties.IsEnabled -and $kind -in @('Button', 'Hyperlink', 'MenuItem', 'ListItem', 'TabItem') -and
        $element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invokePattern)
      $canSet = $properties.IsEnabled -and $kind -in @('Edit', 'Document', 'ComboBox') -and
        $element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern) -and !$valuePattern.Current.IsReadOnly
      if (($canInvoke -or $canSet) -and $element -ne $root) {
        $runtimeId = $element.GetRuntimeId() -join '.'
        $label = if ($name) { $name.Substring(0, [Math]::Min($name.Length, 160)) } else { $kind }
        $automationId = $properties.AutomationId
        $signature = "$runtimeId|$kind|$automationId|$name"
        $key = Get-Stamp $signature
        if ($request.action -eq 'inspect') {
          $controls.Add(@{ key = $key; label = $label; kind = $kind; invoke = [bool]$canInvoke; set = [bool]$canSet })
        } elseif ($request.key -eq $key) {
          if ($request.view -and (Get-ChromeView $root) -ne $request.view) {
            Finish @{ error = 'The selected Chrome tab or page changed. Inspect it again.' }
          }
          if ($request.action -eq 'invoke' -and $canInvoke) {
            $invokePattern.Invoke()
            Finish @{ applied = $true }
          }
          if ($request.action -eq 'set' -and $canSet) {
            $valuePattern.SetValue([string]$request.text)
            Finish @{ applied = $true }
          }
          Finish @{ error = 'The control no longer supports this action.' }
        }
      }
      $child = $walker.GetFirstChild($element)
      $siblings = 0
      while ($child -and $siblings -lt 45 -and $nodes.Count -lt 180) {
        $nodes.Enqueue($child)
        $child = $walker.GetNextSibling($child)
        $siblings++
      }
    } catch [System.Windows.Automation.ElementNotAvailableException] { continue }
  }
  if ($request.action -eq 'inspect') {
    if ($view -and (Get-ChromeView $root) -ne $view) { Finish @{ error = 'The selected Chrome tab or page changed. Inspect it again.' } }
    Finish @{ identity = $identity; application = $application; view = $view; controls = @($controls.ToArray()) }
  }
  Finish @{ error = 'The control changed. Inspect the window again.' }
} catch {
  Finish @{ error = 'Windows could not access the selected window or its controls.' }
}
