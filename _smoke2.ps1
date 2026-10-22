$ErrorActionPreference = 'Stop'
$base = 'http://localhost:4100/api'
$web = New-Object Microsoft.PowerShell.Commands.WebRequestSession
# .NET CookieContainer menja imena kolačića koji sadrže `_` (nx_at → nxat),
# što server ne prepoznaje. Za test preimenujemo u imena koja .NET čuva.
function Allow([string[]]$names) {
  $web.Cookies.SetCookies('http://localhost:4100', ($names | ForEach-Object { "$_=x; path=/" }) -join ', ')
}
function Show($label, $value) { Write-Output "$label => $value" }
function Status($script) { try { & $script; return 'ok' } catch { return [int]$_.Exception.Response.StatusCode } }
function Turnstile { return @{ 'cf-turnstile-response' = 'XXXX.DUMMY.TOKEN.XXXX' } }

$regBody = Turnstile
$regBody.username = "Sec$([int](Get-Random -Max 9999))"
$regBody.email = "sec$([int](Get-Random -Max 99999))@example.com"
$regBody.password = 'Lozinka123!'
$regBody.acceptedTerms = $true
$regBody.ageConfirmed = $true

# 1) Register preko cookie sesije
$reg = Invoke-RestMethod -Uri "$base/auth/register" -Method Post -WebSession $web -ContentType 'application/json' -Body ($regBody | ConvertTo-Json)
Show 'register.user' $reg.user.username
Show 'token-in-body' ($null -ne $reg.token)
Show 'cookies' (($web.Cookies.GetCookies('http://localhost:4100') | ForEach-Object { $_.Name }) -join ',')

# 2) /me preko HttpOnly cookie-ja
$me = Invoke-RestMethod -Uri "$base/auth/me" -WebSession $web
Show 'me' $me.user.username

# 3) CSRF: mutacija bez zaglavlja mora da padne
$csrf = ($web.Cookies.GetCookies('http://localhost:4100') | Where-Object Name -eq 'nx_csrf').Value
$h = @{ 'X-CSRF-Token' = $csrf }
Show 'csrf-missing' (Status { Invoke-RestMethod -Uri "$base/auth/2fa/setup" -Method Post -WebSession $web })

# 4) 2FA setup + enable
$setup = Invoke-RestMethod -Uri "$base/auth/2fa/setup" -Method Post -WebSession $web -Headers $h
Show '2fa.qr' $setup.qrCode.Substring(0, 22)
$env:TOTP_SECRET = $setup.secret
$code = node -e "import('otplib').then(async m => console.log(await m.generate({secret: process.env.TOTP_SECRET})))"
$enable = Invoke-RestMethod -Uri "$base/auth/2fa/enable" -Method Post -WebSession $web -Headers $h -ContentType 'application/json' -Body (@{ code = $code } | ConvertTo-Json)
Show '2fa.enabled' $enable.enabled
Show '2fa.recoveryCodes' $enable.recoveryCodes.Count

# 5) Refresh rotacija
$refresh = Invoke-RestMethod -Uri "$base/auth/refresh" -Method Post -WebSession $web -Headers $h
Show 'refresh.user' $refresh.user.username

# 6) Logout pa /me → 401
Invoke-RestMethod -Uri "$base/auth/logout" -Method Post -WebSession $web -Headers $h | Out-Null
Show 'me-after-logout' (Status { Invoke-RestMethod -Uri "$base/auth/me" -WebSession $web })

# 7) Login sada traži 2FA
$web2 = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$lb = Turnstile
$lb.email = $regBody.email
$lb.password = 'Lozinka123!'
$lb.rememberMe = $true
$login = Invoke-RestMethod -Uri "$base/auth/login" -Method Post -WebSession $web2 -ContentType 'application/json' -Body ($lb | ConvertTo-Json)
Show 'login.requires2fa' $login.requires2fa
Show 'login.hasSession' ($null -ne $login.user)

# pogrešan kod → 401
$mbad = Turnstile
$mbad.mfaTicket = $login.mfaTicket
$mbad.code = '000000'
Show '2fa.wrong-code' (Status { Invoke-RestMethod -Uri "$base/auth/2fa/login" -Method Post -WebSession $web2 -ContentType 'application/json' -Body ($mbad | ConvertTo-Json) })

# recovery kod (jednokratni)
$rec = Turnstile
$rec.mfaTicket = $login.mfaTicket
$rec.code = $enable.recoveryCodes[0]
$mfa = Invoke-RestMethod -Uri "$base/auth/2fa/login" -Method Post -WebSession $web2 -ContentType 'application/json' -Body ($rec | ConvertTo-Json)
Show '2fa.recovery-login' $mfa.user.username
Show '2fa.recovery-left' $mfa.recoveryCodesLeft

# isti recovery kod drugi put → odbijen
Show '2fa.reused-recovery' (Status { Invoke-RestMethod -Uri "$base/auth/2fa/login" -Method Post -WebSession $web2 -ContentType 'application/json' -Body ($rec | ConvertTo-Json) })

# 8) OAuth: start redirect + neispravan state
$start = Invoke-WebRequest -Uri "$base/auth/oauth/discord" -MaximumRedirection 0 -SkipHttpErrorCheck
Show 'oauth.disabled' $start.StatusCode
try { Invoke-WebRequest -Uri "$base/auth/oauth/discord/callback?code=x" -MaximumRedirection 0 -ErrorAction Stop | Out-Null }
catch { Show 'oauth.badState' ($_.Exception.Response.Headers['Location']) }
