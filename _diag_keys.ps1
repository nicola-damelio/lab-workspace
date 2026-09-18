$r = Invoke-RestMethod -Uri "https://drive-token-server-763848765523.europe-west1.run.app" -Method Post -ContentType "application/json" -Body '{"grant_type":"workspace"}' -TimeoutSec 30
$h = @{ Authorization = "Bearer $($r.access_token)" }
$u = "https://www.googleapis.com/drive/v3/files?q=" + [uri]::EscapeDataString("name='keys.json' and trashed=false") + "&fields=" + [uri]::EscapeDataString("files(id,name,size,modifiedTime)") + "&pageSize=10"
$files = (Invoke-RestMethod -Uri $u -Headers $h -TimeoutSec 40).files
foreach ($f in $files) {
  Write-Output "keys.json file: id=$($f.id) size=$($f.size) modified=$($f.modifiedTime)"
}
$id = $files[0].id
$out = Join-Path $PSScriptRoot "_diag_keys.json"
Invoke-WebRequest -Uri "https://www.googleapis.com/drive/v3/files/$id`?alt=media" -Headers $h -OutFile $out -TimeoutSec 120
$raw = Get-Content -Raw -LiteralPath $out
Write-Output "downloaded bytes: $($raw.Length)"
$state = $raw | ConvertFrom-Json
Write-Output "kind=$($state.kind) at=$($state.at)"
$names = $state.keys.PSObject.Properties.Name
Write-Output "keys ($($names.Count)):"
foreach ($n in $names) {
  $v = $state.keys.$n.v
  $len = if ($v -is [string]) { $v.Length } else { ($v | ConvertTo-Json -Depth 3 -Compress).Length }
  $arrCount = ""
  if ($v -is [System.Object[]]) { $arrCount = "array of $($v.Count)" }
  $canvasCount = ""
  if ($v -is [System.Object[]]) { $canvasCount = "canvasEntries=$(($v | Where-Object { $_ -and $_.canvasData }).Count)" }
  Write-Output ("  {0}  at={1}  chars={2} {3} {4}" -f $n, $state.keys.$n.at, $len, $arrCount, $canvasCount)
}
