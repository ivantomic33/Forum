$ErrorActionPreference = 'Stop'
$base = 'http://localhost:4100/api'
$web = New-Object Microsoft.PowerShell.Commands.WebRequestSession

function Show($label, $value) { Write-Output "$label => $value" }

try {
  # 1) Register (Turnstile off in dev)
  $reg = Invoke-RestMethod -Uri "$base/auth/register" -Method Post -WebSession $web -ContentType 'application/json' -Body (@{
    username = "Sec$([int](Get-Random -Max 9999))"
    email = "sec$([int](Get-Random -Max 99999))@example.com"
    password = 'Lozinka123!'
    acceptedTerms = $true
    ageConfirmed = $true
    'cf-turnstile-response' = 'XXXX.DUMMY.TOKEN.XXXX'
  } | ConvertTo-Json)
  Show 'register.user' $reg.user.username
  Show 'register.hasTokenInBody' ($null -ne $reg.token)
  # Cookie session mora da radi u istom `WebRequestSession` izlaze zahtevi.
  Show 'cookies' (($web.Cookies.GetCookies('http://localhost:4100') | ForEach-Object { $_.Name }) -join ',')

  # 2) /me works via HttpOnly cookie
  $me = Invoke-RestMethod -Uri "$base/auth/me" -WebSession $web
  Show 'me' $me.user.username

  # 3) CSRF: mutating request WITHOUT header must be rejected
  try {
    Invoke-RestMethod -Uri "$base/auth/2fa/setup" -Method Post -WebSession $web | Out-Null
    Show 'csrf-missing' 'NOT BLOCKED (bad)'
  } catch {
    Show 'csrf-missing' "$([int]$_.Exception.Response.StatusCode) (expected 403)"
  }

  # 4) 2FA setup + enable with generated code
  $csrf = ($web.Cookies.GetCookies('http://localhost:4100') | Where-Object Name -eq 'nx_csrf').Value
  $h = @{ 'X-CSRF-Token' = $csrf }
  $setup = Invoke-RestMethod -Uri "$base/auth/2fa/setup" -Method Post -WebSession $web -Headers $h
  Show '2fa.setup.qrPrefix' $setup.qrCode.Substring(0, 22)
  $env:TOTP_SECRET = $setup.secret
  $code = node -e "import('otplib').then(async m => console.log(await m.generate({secret: process.env.TOTP_SECRET})))"
  Show 'totp.code.length' $code.Length
  $enable = Invoke-RestMethod -Uri "$base/auth/2fa/enable" -Method Post -WebSession $web -Headers $h -ContentType 'application/json' -Body (@{ code = $code } | ConvertTo-Json)
  Show '2fa.enabled' $enable.enabled
  Show '2fa.recoveryCodes' $enable.recoveryCodes.Count

  # 5) Refresh rotation
  $refresh = Invoke-RestMethod -Uri "$base/auth/refresh" -Method Post -WebSession $web -Headers $h
  Show 'refresh.user' $refresh.user.username

  # 6) Logout clears session; /me then 401
  Invoke-RestMethod -Uri "$base/auth/logout" -Method Post -WebSession $web -Headers $h | Out-Null
  try { Invoke-RestMethod -Uri "$base/auth/me" -WebSession $web | Out-Null; Show 'me-after-logout' 'STILL AUTHENTICATED (bad)' }
  catch { Show 'me-after-logout' ([int]$_.Exception.Response.StatusCode) }

  # 7) Login now requires 2FA (new session)
  $web2 = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $login = Invoke-RestMethod -Uri "$base/auth/login" -Method Post -WebSession $web2 -ContentType 'application/json' -Body (@{ email = $reg.user.email; password = 'Lozinka123!'; rememberMe = $true; 'cf-turnstile-response' = 'XXXX.DUMMY.TOKEN.XXXX' } | ConvertTo-Json)
  Show 'login.requires2fa' $login.requires2fa
  Show 'login.hasSession' ($null -ne $login.user)
  $env:TOTP_SECRET = $setup.secret
  $code2 = node -e "import('otplib').then(async m => console.log(await m.generate({secret: process.env.TOTP_SECRET})))"
  $mfa = Invoke-RestMethod -Uri "$base/auth/2fa/login" -Method Post -WebSession $web2 -ContentType 'application/json' -Body (@{ mfaTicket = $login.mfaTicket; code = $code2; 'cf-turnstile-response' = 'XXXX.DUMMY.TOKEN.XXXX' } | ConvertTo-Json)
  Show '2fa.login.user' $mfa.user.username

  # 8) OAuth start redirects to provider
  try {
    Invoke-WebRequest -Uri "$base/auth/oauth/discord" -MaximumRedirection 0 -ErrorAction Stop | Out-Null
  } catch {
    Show 'oauth.discord' ($_.Exception.Response.Headers['Location'])
  }
  # Steam callbacks without state must be rejected
  try { Invoke-WebRequest -Uri "$base/auth/oauth/discord/callback?code=x" -MaximumRedirection 0 -ErrorAction Stop | Out-Null }
  catch { Show 'oauth.badState' ($_.Exception.Response.Headers['Location']) }
} catch {
  Show 'FATAL' $_.Exception.Message
  if ($_.ErrorDetails) { Show 'detail' $_.ErrorDetails.Message }
}
