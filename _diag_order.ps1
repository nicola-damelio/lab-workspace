$ErrorActionPreference = 'Continue'
$r = Invoke-RestMethod -Uri "https://drive-token-server-763848765523.europe-west1.run.app" -Method Post -ContentType "application/json" -Body '{"grant_type":"workspace"}' -TimeoutSec 30
$h = @{ Authorization = "Bearer $($r.access_token)" }
# EXACT same shape as driveUpload.findFolderByName: pageSize=10, fields=files(id,name)
function F($q) {
  $u = "https://www.googleapis.com/drive/v3/files?q=" + [uri]::EscapeDataString($q) + "&fields=" + [uri]::EscapeDataString("files(id,name)") + "&pageSize=10"
  @((Invoke-RestMethod -Uri $u -Headers $h -TimeoutSec 60).files)
}
$ds  = '1fiiNoFCfioYFP1rt_1IwV1PZ3d0jlwil'   # dataset folder
$oldP = '1kYVKEVPEtGukfuRntrfbML8HTqmptaRm'  # projects ORIGINAL (11/09)
$newP = '1-77Jv9_k0vnpJsRlUEGGaXRNOFe42b1J'  # projects NEW (today 13:42)
$oldP53 = '1EJAPDHGeftML_Y0VQsiG0koXK_t4N5es' # p53H ORIGINAL
Write-Output "1) app query: name='projects' in dataset folder  -> order returned by Drive:"
$i = 0
foreach ($f in (F("name='projects' and '$ds' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false"))) { $i++; Write-Output "   [$i] '$($f.name)' $($f.id)" }
Write-Output "2) app query: name='images' in ORIGINAL p53H -> order:"
$i = 0
foreach ($f in (F("name='images' and '$oldP53' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false"))) { $i++; Write-Output "   [$i] '$($f.name)' $($f.id)" }
Write-Output "3) app query: name='p53H' in ORIGINAL projects -> order:"
$i = 0
foreach ($f in (F("name='p53H' and '$oldP' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false"))) { $i++; Write-Output "   [$i] '$($f.name)' $($f.id)" }
Write-Output "4) app query: name='p53H' in NEW projects -> order:"
$i = 0
foreach ($f in (F("name='p53H' and '$newP' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false"))) { $i++; Write-Output "   [$i] '$($f.name)' $($f.id)" }
Write-Output "5) file counts of the two 'images' twins in ORIGINAL p53H:"
foreach ($id in @('1OpiczVSagUCSpd8bO8NwpuvokaCNajeQ','1xMMGSCFbLPgnet2fdyIxylJ1PNRSSp8p')) {
  $u = "https://www.googleapis.com/drive/v3/files?q=" + [uri]::EscapeDataString("'$id' in parents and trashed=false") + "&fields=files(id,name)&pageSize=1000"
  Write-Output "   $id -> $(@((Invoke-RestMethod -Uri $u -Headers $h -TimeoutSec 60).files).Count) file(s)"
}
