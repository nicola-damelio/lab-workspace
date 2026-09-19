$ErrorActionPreference = 'Continue'
$r = Invoke-RestMethod -Uri "https://drive-token-server-763848765523.europe-west1.run.app" -Method Post -ContentType "application/json" -Body '{"grant_type":"workspace"}' -TimeoutSec 30
$h = @{ Authorization = "Bearer $($r.access_token)" }
function L($q) {
  $u = "https://www.googleapis.com/drive/v3/files?q=" + [uri]::EscapeDataString($q) + "&fields=" + [uri]::EscapeDataString("files(id,name,mimeType,size,createdTime,modifiedTime,trashed,parents)") + "&pageSize=1000"
  @((Invoke-RestMethod -Uri $u -Headers $h -TimeoutSec 60).files)
}
$targets = @(
  @{ label = 'projects NEW (created today 13:42 local)'; id = '1-77Jv9_k0vnpJsRlUEGGaXRNOFe42b1J' },
  @{ label = 'projects ORIGINAL (created 11/09)';       id = '1kYVKEVPEtGukfuRntrfbML8HTqmptaRm' }
)
foreach ($t in $targets) {
  Write-Output "=== $($t.label) [$($t.id)]"
  $projs = L("'$($t.id)' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false")
  if (-not $projs) { Write-Output "   (empty)"; continue }
  foreach ($p in $projs) {
    Write-Output "   project folder '$($p.name)' [$($p.id)] created=$($p.createdTime)"
    $subs = L("'$($p.id)' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false")
    foreach ($s in $subs) {
      $f = L("'$($s.id)' in parents and trashed=false")
      Write-Output "      '$($s.name)' : $(@($f).Count) file(s) [$($s.id)]"
      foreach ($x in ($f | Sort-Object modifiedTime -Descending | Select-Object -First 14)) {
        Write-Output "          - $($x.name)  [$($x.size) B, mod $($x.modifiedTime)]"
      }
    }
  }
}
