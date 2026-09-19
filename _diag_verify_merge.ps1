# _diag_verify_merge.ps1 — READ-ONLY. Vérifie APRÈS réparation que :
#   • les 38 figures du jumeau sont bien dans projects/p53H/images du conteneur
#     RETENU (1kYVKE…) et que projects/unassigned/images porte la sienne ;
#   • les deux jumeaux sont dans la CORBEILLE (rien n'a été supprimé) ;
#   • un seul `projects` / `protocols` reste visible.
$ErrorActionPreference = 'Continue'
$r = Invoke-RestMethod -Uri "https://drive-token-server-763848765523.europe-west1.run.app" -Method Post -ContentType "application/json" -Body '{"grant_type":"workspace"}' -TimeoutSec 30
$h = @{ Authorization = "Bearer $($r.access_token)" }
$FOLDER = 'application/vnd.google-apps.folder'
function L($q) {
  $u = "https://www.googleapis.com/drive/v3/files?q=" + [uri]::EscapeDataString($q) +
       "&fields=" + [uri]::EscapeDataString("files(id,name,mimeType,size,createdTime,modifiedTime)") + "&pageSize=1000"
  try { (Invoke-RestMethod -Uri $u -Headers $h -TimeoutSec 40).files } catch { @() }
}
$DS = '1fiiNoFCfioYFP1rt_1IwV1PZ3d0jlwil'
$KEPT = '1kYVKEVPEtGukfuRntrfbML8HTqmptaRm'
$OLD_NEW_TWIN = '1-77Jv9_k0vnpJsRlUEGGaXRNOFe42b1J'
$OLD_PROTO_TWIN = '1a4AOFG34Ug3DZ_Ju9DrM0FKd3I03Vb5c'

Write-Output "== Conteneurs visibles dans le dataset"
foreach ($n in @('projects', 'protocols')) {
  foreach ($t in (L("'$DS' in parents and name='$n' and mimeType='$FOLDER' and trashed=false"))) {
    Write-Output "  '$n' [$($t.id)] created=$($t.createdTime)"
  }
}
Write-Output "== Contenu du conteneur RETENU `projects` [$KEPT]"
foreach ($p in (L("'$KEPT' in parents and mimeType='$FOLDER' and trashed=false"))) {
  Write-Output "  $($p.name)/"
  foreach ($leaf in (L("'$($p.id)' in parents and mimeType='$FOLDER' and trashed=false"))) {
    $files = @(L("'$($leaf.id)' in parents and trashed=false"))
    $bytes = ($files | ForEach-Object { if ($_.size) { [int64]$_.size } } | Measure-Object -Sum).Sum
    Write-Output "     $($leaf.name)/ : $($files.Count) fichier(s), $bytes octets"
    $recent = @($files | Where-Object { $_.modifiedTime -gt '2026-09-19T11:42:00Z' })
    Write-Output "        dont $($recent.Count) avec mod > 2026-09-19T11:42Z (ceux du jumeau fusionné)"
  }
}
Write-Output "== Jumeaux dans la CORBEILLE (rien n'a été supprimé définitivement)"
foreach ($id in @($OLD_NEW_TWIN, $OLD_PROTO_TWIN)) {
  $meta = Invoke-RestMethod -Uri "https://www.googleapis.com/drive/v3/files/$id`?fields=id,name,trashed" -Headers $h -TimeoutSec 30
  Write-Output "  [$id] name='$($meta.name)' trashed=$($meta.trashed)"
}
