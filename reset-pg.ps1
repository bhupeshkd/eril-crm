$ErrorActionPreference = 'Continue'
$hba = 'C:\Program Files\PostgreSQL\18\data\pg_hba.conf'
Write-Output "hba exists: $(Test-Path $hba)"
Write-Output "--- current scram lines ---"
Select-String -Path $hba -Pattern 'scram|trust' | Select-Object -First 8 | ForEach-Object { $_.Line }
Write-Output "--- reload config ---"
& 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe' reload -D 'C:\Program Files\PostgreSQL\18\data' 2>&1
Write-Output "reload exit=$LASTEXITCODE"
Start-Sleep -Seconds 2
Write-Output "--- set password (trust should now allow) ---"
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -h localhost -U postgres -d postgres -c "ALTER USER postgres WITH PASSWORD 'eril_dev_pass';" 2>&1
Write-Output "--- restore pg_hba from backup ---"
Copy-Item "$hba.bak" $hba -Force
& 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe' reload -D 'C:\Program Files\PostgreSQL\18\data' 2>&1
Write-Output "--- test md5 login with new password ---"
$env:PGPASSWORD = 'eril_dev_pass'
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -h localhost -U postgres -d postgres -c "select current_user, current_database();" 2>&1