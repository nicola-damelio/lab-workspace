# Audit: for every component file under src/components/AppModules/, flag any
# App.jsx *function-local* name (state vars, useMemo/useCallback results,
# handler functions, etc.) that is USED in the file but neither declared in a
# component's props, nor imported, nor defined locally, nor a global.
# Catches the "mergedPlan is not defined" class of bug (a prop omitted when a
# module was extracted out of the App component).
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/audit-module-props.ps1

$appLines = [System.IO.File]::ReadAllLines('src/App.jsx')
# Find the App function body (from 'export default function App' to the closing '}').
$appStart = -1
for($i=0;$i -lt $appLines.Count;$i++){ if($appLines[$i] -match '^export default function App'){ $appStart = $i; break } }
if($appStart -lt 0){ 'App function not found'; exit 1 }
# The App function is the last top-level function; body = appStart..end of file.
$body = $appLines[$appStart..($appLines.Count-1)] -join "`n"

# App-local names: any `const/let/var/function NAME` inside the App body.
$appNames = @()
foreach($m in [regex]::Matches($body, '\b(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)')){ $appNames += $m.Groups[1].Value }
# Also names defined via `export default function App` itself and helper closures are not relevant.
$appNames = $appNames | Sort-Object -Unique

$globals = @('window','document','console','alert','confirm','prompt','setTimeout','clearTimeout','setInterval','clearInterval','fetch','URL','FileReader','TextEncoder','TextDecoder','crypto','Promise','JSON','Math','Date','String','Number','Boolean','Array','Object','Symbol','RegExp','Map','Set','WeakMap','WeakSet','parseInt','parseFloat','isNaN','encodeURIComponent','decodeURIComponent','localStorage','sessionStorage','Blob','FormData','btoa','atob','structuredClone','performance','location','navigator','history','requestAnimationFrame','cancelAnimationFrame','CustomEvent','Event','KeyboardEvent','MouseEvent','Image','DOMParser','AbortController','IntersectionObserver','ResizeObserver','MutationObserver','File','FileList','React','useState','useEffect','useRef','useMemo','useCallback','useReducer','useContext','useLayoutEffect','useImperativeHandle','useTransition','useDeferredValue','useId','useSyncExternalStore','Fragment','Suspense','lazy','memo','Children','isValidElement','createElement','createContext','createRef','forwardRef','startTransition','useDebugValue','alert','confirm')

$targets = Get-ChildItem 'src/components/AppModules' -File -Include *.jsx
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
  # props: names inside the component signature `export const X = ({ ... })` or `=> (props)`.
  $props = @()
  foreach($m in [regex]::Matches($content, '= \(\{\s*([\s\S]*?)\s*\}\)\s*=>|\(\{\s*([\s\S]*?)\s*\}\)\s*=>\s*\(')){
    $grp = if($m.Groups[1].Value){$m.Groups[1].Value}else{$m.Groups[2].Value}
    ($grp -split ',') | ForEach-Object {
      $t = $_.Trim()
      if($t -match '^([A-Za-z_$][\w$]*)\s*='){ $props += $Matches[1] }
      elseif($t -match '^([A-Za-z_$][\w$]*)$'){ $props += $t }
    }
  }
  $defined = @($local + $imported + $props + $globals) | Sort-Object -Unique
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
    '=== ' + $file.Name + ' ==='
    $flags | ForEach-Object { '  ' + $_ }
  }
}
if(!$anyFlags){ 'No App-local references missing from props/imports in any module.' }
