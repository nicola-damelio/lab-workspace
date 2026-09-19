# _diag_containers.ps1 — READ-ONLY. Repère les CONTENEURS CANONIQUES DUPLIQUÉS
# (projects / protocols / backups / storage / publications / Budget_labo) dans
# chaque dossier de dataset de "Lab Workspace", et dit lequel porte du contenu.
# Aucune écriture : uniquement files.list. Voir src/utils/driveUpload.js
# (findOrCreateFolder) et docs/DRIVE-MIRROR.md.
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
$canonical = @('projects', 'backups', 'protocols', 'storage', 'publications', 'Budget_labo')
$duplicates = 0
$root = @(L("name='Lab Workspace' and mimeType='$FOLDER' and trashed=false"))
Write-Output "Lab Workspace folders found: $($root.Count)"
foreach ($rr in $root) {
  Write-Output "== 'Lab Workspace' [$($rr.id)]"
  $children = @(L("'$($rr.id)' in parents and mimeType='$FOLDER' and trashed=false"))
  foreach ($d in $children) {
    if ($d.name -eq '_workspace') { Write-Output "   (memoire app) _workspace [$($d.id)]"; continue }
    Write-Output "   dataset: '$($d.name)' [$($d.id)] created=$($d.createdTime)"
    $subs = @(L("'$($d.id)' in parents and mimeType='$FOLDER' and trashed=false"))
    foreach ($c in $canonical) {
      $twins = @($subs | Where-Object { $_.name -eq $c })
      if ($twins.Count -eq 0) { continue }
      foreach ($t in $twins) {
        $inside = @(L("'$($t.id)' in parents and trashed=false"))
        $extra = ''
        if ($inside.Count -gt 0 -and $inside.Count -le 12) {
          $extra = ' -> ' + (($inside | ForEach-Object { $_.name }) -join ', ')
        }
        Write-Output "      '$c' [$($t.id)] created=$($t.createdTime) items=$($inside.Count)$extra"
      }
      if ($twins.Count -gt 1) {
        $duplicates++
        Write-Output "      !! DOUBLON: '$c' x$($twins.Count) dans '$($d.name)'"
      }
    }
  }
}
Write-Output "TOTAL conteneurs dupliques: $duplicates"
