$ErrorActionPreference = 'Stop'
$secret = 'k' * 48
$env:PORT = '4100'
$env:NODE_ENV = 'development'
$env:JWT_SECRET = $secret
$env:SUPABASE_URL = 'memory'
$env:SUPABASE_SERVICE_KEY = 'memory'
$env:CLIENT_URL = 'http://localhost:5173'
$env:PUBLIC_APP_URL = 'http://localhost:5173'
$env:TURNSTILE_ENFORCE = '1'
$env:TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$p = Start-Process -FilePath 'node' -ArgumentList '--import', 'tsx', 'index.ts' -WorkingDirectory (Join-Path $root 'server') -PassThru -RedirectStandardOutput (Join-Path $root '_srv.log') -RedirectStandardError (Join-Path $root '_srv.err') -WindowStyle Hidden
"pid=$($p.Id)"
Start-Sleep -Seconds 12
"pid=$($p.Id)"
try { (Invoke-RestMethod -Uri 'http://localhost:4100/api/auth/config' | ConvertTo-Json -Compress) } catch { "config failed: $($_.Exception.Message)" }
Get-Content (Join-Path $root '_srv.err') -Tail 5
