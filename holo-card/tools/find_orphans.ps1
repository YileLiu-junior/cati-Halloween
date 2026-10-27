$procs = Get-CimInstance Win32_Process | Where-Object {
  ($_.Name -in @('msedge.exe','node.exe')) -and $_.CommandLine -and
  ($_.CommandLine -match 'remote-debugging-port' -or $_.CommandLine -match 'verify_local' -or $_.CommandLine -match 'user-data-dir')
}
foreach ($p in $procs) {
  $c = $p.CommandLine
  if ($c.Length -gt 130) { $c = $c.Substring(0, 130) }
  Write-Output ("PID=" + $p.ProcessId + "  " + $p.Name + "  " + $c)
}
