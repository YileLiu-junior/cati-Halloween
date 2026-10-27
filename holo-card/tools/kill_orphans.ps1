$killed = 0
Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq 'msedge.exe' -and $_.CommandLine -and
  ($_.CommandLine -match 'swiftshader' -or $_.CommandLine -match 'holo-')
} | ForEach-Object {
  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  $killed++
}
Write-Output ("killed msedge orphans: " + $killed)
Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq 'node.exe' -and $_.CommandLine -and $_.CommandLine -match 'probe_kit'
} | ForEach-Object {
  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  Write-Output ("killed probe node: " + $_.ProcessId)
}
