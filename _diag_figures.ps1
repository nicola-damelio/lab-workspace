$ErrorActionPreference = 'Continue'
$r = Invoke-RestMethod -Uri "https://drive-token-server-763848765523.europe-west1.run.app" -Method Post -ContentType "application/json" -Body '{"grant_type":"workspace"}' -TimeoutSec 30
$h = @{ Authorization = "Bearer $($r.access_token)" }
function L($q) {
  $u = "https://www.googleapis.com/drive/v3/files?q=" + [uri]::EscapeDataString($q) + "&fields=" + [uri]::EscapeDataString("files(id,name,mimeType,size,createdTime,modifiedTime,trashed)") + "&pageSize=1000"
  @((Invoke-RestMethod -Uri $u -Headers $h -TimeoutSec 60).files)
}
$roots = L("name='Lab Workspace' and mimeType='application/vnd.google-apps.folder' and trashed=false")
Write-Output "APP ROOTS: $(@($roots).Count)"
foreach ($root in $roots) {
  Write-Output "=== APP ROOT: $($root.name) [$($root.id)]"
  $dsets = L("'$($root.id)' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false")
  foreach ($d in $dsets) {
    if ($d.name -eq '_workspace') { Write-Output "  -- _workspace"; continue }
    Write-Output "  -- dataset folder: '$($d.name)' [$($d.id)] created=$($d.createdTime)"
    $pr = L("'$($d.id)' in parents and name='projects' and mimeType='application/vnd.google-apps.folder' and trashed=false")
    if (-not $pr) { Write-Output "     (no projects folder)"; continue }
    Write-Output "     projects [$($pr[0].id)] created=$($pr[0].createdTime)"
    $projs = L("'$($pr[0].id)' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false")
    foreach ($p in $projs) {
      $subs = L("'$($p.id)' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false")
      if (-not $subs) { Write-Output "     '$($p.name)' [$($p.id)] : no subfolder"; continue }
      foreach ($s in $subs) {
        $f = L("'$($s.id)' in parents and trashed=false")
        Write-Output "     '$($p.name)' / '$($s.name)' : $(@($f).Count) file(s)  sub=[$($s.id)] created=$($s.createdTime)"
      }
    }
  }
}
