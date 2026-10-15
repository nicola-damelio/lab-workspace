# Attend la fin de la suite complète, puis compare le rapport d'APRÈS avec celui
# d'AVANT la réparation (_suite_report_prev.txt) et écrit le verdict dans _VERDICT.txt.
Set-Location 'c:\Users\nicol\lab-workspace'
while (-not (Test-Path '_suite_report.txt')) { Start-Sleep -Seconds 10 }
$o = @('suite finie ' + (Get-Date -Format HH:mm:ss))
node _cmp.mjs *> _cmp_console.txt
if (Test-Path '_cmp.txt') { $o += (Get-Content '_cmp.txt' -Encoding UTF8) } else { $o += '(comparaison indisponible)' }
$o += 'suite total: ' + ((Get-Content '_suite_report.txt' -Encoding UTF8 | Select-Object -Last 1))
$o | Out-File -Encoding UTF8 '_VERDICT.txt'
Remove-Item '_cmp.mjs' -Force -ErrorAction SilentlyContinue
Remove-Item '_suite_run.txt' -Force -ErrorAction SilentlyContinue
Remove-Item '_suite_clock.txt' -Force -ErrorAction SilentlyContinue
