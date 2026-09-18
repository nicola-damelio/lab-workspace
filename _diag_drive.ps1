$r = Invoke-RestMethod -Uri "https://drive-token-server-763848765523.europe-west1.run.app" -Method Post -ContentType "application/json" -Body '{"grant_type":"workspace"}' -TimeoutSec 30
$h = @{ Authorization = "Bearer $($r.access_token)" }
function L($q) {
  $u = "https://www.googleapis.com/drive/v3/files?q=" + [uri]::EscapeDataString($q) + "&fields=" + [uri]::EscapeDataString("files(id,name,mimeType,size,createdTime,modifiedTime)") + "&pageSize=200"
  (Invoke-RestMethod -Uri $u -Headers $h -TimeoutSec 40).files
}
$root = L("name='Lab Workspace' and mimeType='application/vnd.google-apps.folder' and trashed=false")
foreach ($rr in $root) {
  foreach ($d in (L("'$($rr.id)' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false"))) {
    if ($d.name -eq "_workspace") { continue }
    $pr = L("'$($d.id)' in parents and name='projects' and mimeType='application/vnd.google-apps.folder' and trashed=false")
    if (-not $pr) { Write-Output "$($d.name): NO projects folder"; continue }
    foreach ($p in (L("'$($pr[0].id)' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false"))) {
      $img = L("'$($p.id)' in parents and name='images' and mimeType='application/vnd.google-apps.folder' and trashed=false")
      if (-not $img) { Write-Output "$($d.name) / projects / $($p.name): no images folder"; continue }
      $files = L("'$($img[0].id)' in parents and trashed=false")
      Write-Output "$($d.name) / projects / $($p.name) / images : $($files.Count) file(s)"
      foreach ($f in ($files | Sort-Object modifiedTime -Descending | Select-Object -First 12)) {
        Write-Output "    - $($f.name)  [$($f.size) bytes, mod $($f.modifiedTime)]"
      }
    }
  }
}
