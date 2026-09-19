# _diag_twins.ps1 — READ-ONLY. Arbre des DEUX jumeaux 'projects' et 'protocols' du
# dataset GEC-UPJV-projects (profondeur 3, dossiers + fichiers) : dit si les
# fichiers d'un même projet sont ÉPARPILLÉS entre les deux conteneurs.
$ErrorActionPreference = 'Continue'
$r = Invoke-RestMethod -Uri "https://drive-token-server-763848765523.europe-west1.run.app" -Method Post -ContentType "application/json" -Body '{"grant_type":"workspace"}' -TimeoutSec 30
$h = @{ Authorization = "Bearer $($r.access_token)" }
$FOLDER = 'application/vnd.google-apps.folder'
function L($q) {
  $u = "https://www.googleapis.com/drive/v3/files?q=" + [uri]::EscapeDataString($q) +
       "&fields=" + [uri]::EscapeDataString("files(id,name,mimeType,size,createdTime,modifiedTime)") + "&pageSize=1000"
  try { (Invoke-RestMethod -Uri $u -Headers $h -TimeoutSec 40).files }
  catch { Write-Output "   (list failed: $($_.Exception.Message))"; @() }
}
function Tree($id, $depth, $max) {
  if ($depth -gt $max) { return }
  $kids = @(L("'$id' in parents and trashed=false") | Sort-Object mimeType, name)
  foreach ($k in $kids) {
    $isFolder = ($k.mimeType -eq $FOLDER)
    $pad = ' ' * (4 * ($depth + 1))
    if ($isFolder) {
      $n = @(L("'$($k.id)' in parents and trashed=false")).Count
      Write-Output "$pad[DIR ] $($k.name)  (items=$n) [$($k.id)]"
      Tree $k.id ($depth + 1) $max
    } else {
      Write-Output "$pad[FILE] $($k.name)  ($($k.size)B, mod $($k.modifiedTime))"
    }
  }
}
$DS = '1fiiNoFCfioYFP1rt_1IwV1PZ3d0jlwil'
$projects = @(L("'$DS' in parents and name='projects' and mimeType='$FOLDER' and trashed=false") | Sort-Object createdTime)
$protocols = @(L("'$DS' in parents and name='protocols' and mimeType='$FOLDER' and trashed=false") | Sort-Object createdTime)
Write-Output "### JUMEAUX 'projects' ($($projects.Count))"
foreach ($p in $projects) {
  $n = @(L("'$($p.id)' in parents and trashed=false")).Count
  Write-Output "== projects [$($p.id)] created=$($p.createdTime) total=$n"
  Tree $p.id 0 3
}
Write-Output ""
Write-Output "### JUMEAUX 'protocols' ($($protocols.Count))"
foreach ($p in $protocols) {
  $n = @(L("'$($p.id)' in parents and trashed=false")).Count
  Write-Output "== protocols [$($p.id)] created=$($p.createdTime) total=$n"
  Tree $p.id 0 3
}
