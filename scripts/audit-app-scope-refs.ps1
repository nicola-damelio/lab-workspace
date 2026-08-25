# Audit: for every module under src/, flag any App.jsx module-scope name that is
# USED in the file but neither defined locally nor imported. Catches the
# runtime ReferenceError class of bugs (e.g. missing useCallback import,
# SPECIAL_PAGES / CUSTOM_FIELD_TAB_OPTIONS not imported after extraction).
# Known false positives: common names ('id', 'All', 'app') matched as object
# properties or strings; Chart.js options (usePointStyle), html2canvas
# (useCORS) and parameter names (useInternal) matched by the hook heuristic.
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/audit-app-scope-refs.ps1
param([string]$Root = 'src')
$appText = [System.IO.File]::ReadAllText((Join-Path $Root 'App.jsx'))
$appNames = @()
foreach($m in [regex]::Matches($appText, '(?m)^(?:export\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)')){ $appNames += $m.Groups[1].Value }
$appNames = $appNames | Sort-Object -Unique

$globals = @('window','document','console','alert','confirm','prompt','setTimeout','clearTimeout','setInterval','clearInterval','fetch','URL','FileReader','TextEncoder','TextDecoder','crypto','Promise','JSON','Math','Date','String','Number','Boolean','Array','Object','Symbol','RegExp','Map','Set','WeakMap','WeakSet','parseInt','parseFloat','isNaN','encodeURIComponent','decodeURIComponent','localStorage','sessionStorage','Blob','FormData','btoa','atob','structuredClone','performance','location','navigator','history','requestAnimationFrame','cancelAnimationFrame','CustomEvent','Event','KeyboardEvent','MouseEvent','Image','DOMParser','AbortController','IntersectionObserver','ResizeObserver','MutationObserver','File','FileList','React','useState','useEffect','useRef','useMemo','useCallback','useReducer','useContext','useLayoutEffect','useImperativeHandle','useTransition','useDeferredValue','useId','useSyncExternalStore','Fragment','Suspense','lazy','memo','Children','isValidElement','createElement','createContext','createRef','forwardRef','startTransition','useDebugValue')

$targets = Get-ChildItem (Join-Path $Root 'components') -Recurse -File -Include *.jsx,*.js
$targets += Get-ChildItem (Join-Path $Root 'utils') -Recurse -File -Include *.jsx,*.js -ErrorAction SilentlyContinue
$targets += Get-ChildItem (Join-Path $Root 'data') -Recurse -File -Include *.jsx,*.js -ErrorAction SilentlyContinue
$targets += Get-ChildItem (Join-Path $Root 'hooks') -Recurse -File -Include *.jsx,*.js -ErrorAction SilentlyContinue
$anyFlags = $false
foreach($file in $targets){
  $content = [System.IO.File]::ReadAllText($file.FullName)
  $local = @()
  foreach($m in [regex]::Matches($content, '\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)')){ $local += $m.Groups[1].Value }
  $imported = @()
  foreach($m in [regex]::Matches($content, 'import\s+([^;]+?)\s+from')){
    $spec = $m.Groups[1].Value
    if($spec -match '^\s*([A-Za-z_$][\w$]*)\s*,'){ $imported += $Matches[1] }
    elseif($spec -match '^\s*([A-Za-z_$][\w$]*)\s*$'){ $imported += $Matches[1] }
    if($spec -match '\*\s+as\s+([A-Za-z_$][\w$]*)'){ $imported += $Matches[1] }
    if($spec -match '\{\s*([^}]*)\}'){
      ($Matches[1] -split ',') | ForEach-Object {
        $n = $_.Trim()
        if($n -match '^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)'){ $imported += $Matches[2] }
        elseif($n -match '^([A-Za-z_$][\w$]*)$'){ $imported += $Matches[1] }
      }
    }
  }
  $defined = @($local + $imported + $globals) | Sort-Object -Unique
  $lines = [System.IO.File]::ReadAllLines($file.FullName)
  $flags = @()
  foreach($name in $appNames){
    if($defined -notcontains $name -and [regex]::IsMatch($content, '\b' + [regex]::Escape($name) + '\b')){
      $hits = @()
      for($i=0;$i -lt $lines.Count;$i++){ if($lines[$i] -match ('\b'+[regex]::Escape($name)+'\b')){ $hits += ($i+1) } }
      $flags += ($name + ' @ ' + ($hits -join ','))
    }
  }
  if($flags.Count){
    $anyFlags = $true
    '=== ' + $file.FullName.Replace((Get-Location).Path + '\','') + ' ==='
    $flags | ForEach-Object { '  ' + $_ }
  }
}
if(!$anyFlags){ 'No App-scope references found in any scanned file.' }
