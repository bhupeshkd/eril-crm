$ErrorActionPreference = 'Stop'
$env:PGPASSWORD = 'eril_dev_pass'
$psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
Write-Output "=== create eril db ==="
& $psql -h localhost -U postgres -d postgres -c "SELECT 1 FROM pg_database WHERE datname='eril'" -t -A 2>&1
$exists = (& $psql -h localhost -U postgres -d postgres -t -A -c "SELECT 1 FROM pg_database WHERE datname='eril'" 2>&1)
if ($exists -ne '1') {
  & $psql -h localhost -U postgres -d postgres -c "CREATE DATABASE eril;" 2>&1
} else {
  Write-Output "eril db already exists"
}
Write-Output "=== verify ==="
& $psql -h localhost -U postgres -d eril -c "select current_database(), version();" 2>&1