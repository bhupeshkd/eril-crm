$ErrorActionPreference = 'Stop'
$base = 'http://localhost:3001/api/v1'
$env:NODE_ENV = 'development'

function Show($label, $obj) {
  Write-Output ("--- {0} ---" -f $label)
  Write-Output ($obj | ConvertTo-Json -Depth 6)
}

$email = "smoke-$([guid]::NewGuid().ToString('N').Substring(0,8))@test.com"
$password = 'SmokeTest@123'

Write-Output "=== 1. health ==="
try { Invoke-RestMethod -Uri "$base/health" -TimeoutSec 5 | ConvertTo-Json -Depth 3 } catch { Write-Output "health err: $_" }

Write-Output "=== 2. register ==="
$body = @{ email = $email; password = $password; name = 'Smoke Tester' } | ConvertTo-Json
$reg = Invoke-RestMethod -Uri "$base/auth/register" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 10
Show 'register response (keys)' ($reg | Get-Member -MemberType NoteProperty | Select-Object -ExpandProperty Name)

Write-Output "=== 3. login ==="
$loginBody = @{ email = $email; password = $password } | ConvertTo-Json
$login = Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType 'application/json' -Body $loginBody -TimeoutSec 10
$access = $login.accessToken ?? $login.access_token ?? $login.token
$refresh = $login.refreshToken ?? $login.refresh_token
Show 'login keys' ($login | Get-Member -MemberType NoteProperty | Select-Object -ExpandProperty Name)
if (-not $access) { Write-Output "LOGIN FAILED"; exit 1 }
Write-Output "access token len: $($access.Length), refresh present: $([bool]$refresh)"

Write-Output "=== 4. /auth/me ==="
$headers = @{ Authorization = "Bearer $access" }
try { $me = Invoke-RestMethod -Uri "$base/auth/me" -Headers $headers -TimeoutSec 10; Show 'me' $me } catch { Show 'me error' $_.Exception.Message }

Write-Output "=== 5. refresh rotation ==="
if ($refresh) {
  $refBody = @{ refreshToken = $refresh } | ConvertTo-Json
  try {
    $rot = Invoke-RestMethod -Uri "$base/auth/refresh" -Method Post -ContentType 'application/json' -Body $refBody -TimeoutSec 10
    Show 'refresh keys' ($rot | Get-Member -MemberType NoteProperty | Select-Object -ExpandProperty Name)
  } catch { Show 'refresh error' $_.Exception.Message }
}

Write-Output "=== 6. orgs list ==="
try { $orgs = Invoke-RestMethod -Uri "$base/organizations" -Headers $headers -TimeoutSec 10; Show 'orgs' $orgs } catch { Show 'orgs error' $_.Exception.Message }

Write-Output "=== 7. workspaces list ==="
try { $ws = Invoke-RestMethod -Uri "$base/workspaces" -Headers $headers -TimeoutSec 10; Show 'workspaces' $ws } catch { Show 'workspaces error' $_.Exception.Message }

Write-Output "=== 8. sessions list ==="
try { $s = Invoke-RestMethod -Uri "$base/auth/sessions" -Headers $headers -TimeoutSec 10; Show 'sessions' $s } catch { Show 'sessions error' $_.Exception.Message }

Write-Output "=== 9. DB rows ==="
$env:PGPASSWORD = 'eril_dev_pass'
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -h localhost -U postgres -d eril -c "select id, email, name, role from users;" 2>&1
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -h localhost -U postgres -d eril -c "select count(*) as session_rows from sessions;" 2>&1