$ErrorActionPreference = 'Stop'
$env:PGPASSWORD = 'eril_dev_pass'
$psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
$env:DATABASE_URL = ''
Write-Output "=== running migrations ==="
Set-Location d:\eril\backend
cmd /c "npm run migration:run > d:\eril\migration.log 2>&1"
Write-Output "migration exit=$LASTEXITCODE"
Get-Content d:\eril\migration.log -Tail 30
Write-Output "=== tables created ==="
& $psql -h localhost -U postgres -d eril -c "\dt" 2>&1
Write-Output "=== users table columns ==="
& $psql -h localhost -U postgres -d eril -c "\d users" 2>&1
Write-Output "=== sessions table columns ==="
& $psql -h localhost -U postgres -d eril -c "\d sessions" 2>&1