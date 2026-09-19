$ErrorActionPreference = 'Continue'
$r = Invoke-RestMethod -Uri "https://drive-token-server-763848765523.europe-west1.run.app" -Method Post -ContentType "application/json" -Body '{"grant_type":"workspace"}' -TimeoutSec 30
$h = @{ Authorization = "Bearer $($r.access_token)" }
function L($q) {
  $u = "https://www.googleapis.com/drive/v3/files?q=" + [uri]::EscapeDataString($q) + "&fields=" + [uri]::EscapeDataString("files(id,name,mimeType,size,createdTime,modifiedTime,trashed,parents)") + "&pageSize=1000"
  @((Invoke-RestMethod -Uri $u -Headers $h -TimeoutSec 60).files)
}
$ds = '1fiiNoFCfioYFP1rt_1IwV1PZ3d0jlwil'
Write-Output "=== CHILDREN of dataset folder GEC-UPJV-projects (visible) ==="
foreach ($f in (L("'$ds' in parents and trashed=false"))) { Write-Output "  $($f.mimeType.Split('.')[-1]) '$($f.name)' [$($f.id)] created=$($f.createdTime) mod=$($f.modifiedTime)" }
Write-Output "=== CHILDREN of dataset folder GEC-UPJV-projects (TRASHED) ==="
foreach ($f in (L("'$ds' in parents and trashed=true"))) { Write-Output "  TRASH $($f.mimeType.Split('.')[-1]) '$($f.name)' [$($f.id)] created=$($f.createdTime) mod=$($f.modifiedTime)" }
Write-Output "=== Any folder named 'projects' (visible) ==="
foreach ($f in (L("name='projects' and mimeType='application/vnd.google-apps.folder' and trashed=false"))) { Write-Output "  '$($f.name)' [$($f.id)] parents=$($f.parents -join ',') created=$($f.createdTime)" }
Write-Output "=== Any folder named 'projects' (TRASHED) ==="
foreach ($f in (L("name='projects' and mimeType='application/vnd.google-apps.folder' and trashed=true"))) { Write-Output "  TRASH '$($f.name)' [$($f.id)] parents=$($f.parents -join ',') created=$($f.createdTime) mod=$($f.modifiedTime)" }
Write-Output "=== Search: Canvas_18092026 (visible) ==="
foreach ($f in (L("name contains 'Canvas_18092026' and trashed=false"))) { Write-Output "  '$($f.name)' [$($f.id)] parents=$($f.parents -join ',') mod=$($f.modifiedTime)" }
Write-Output "=== Search: Canvas_18092026 (TRASHED) ==="
foreach ($f in (L("name contains 'Canvas_18092026' and trashed=true"))) { Write-Output "  TRASH '$($f.name)' [$($f.id)] parents=$($f.parents -join ',') mod=$($f.modifiedTime)" }
Write-Output "=== Search: images folders with 2+ (TRASHED) ==="
foreach ($f in (L("name='images' and mimeType='application/vnd.google-apps.folder' and trashed=true"))) { Write-Output "  TRASH '$($f.name)' [$($f.id)] parents=$($f.parents -join ',') mod=$($f.modifiedTime)" }
Write-Output "=== Trash overview (first 40) ==="
foreach ($f in (L("trashed=true"))) { Write-Output "  TRASH '$($f.name)' [$($f.id)] mod=$($f.modifiedTime)" }
