# PowerShell script to allow Beamer+ through Windows Firewall
Write-Host "Adding Windows Firewall rule for Beamer+..." -ForegroundColor Cyan

# Add firewall rule for Python
$pythonPath = (Get-Command python).Source
New-NetFirewallRule -DisplayName "Beamer+ Server" -Direction Inbound -Program $pythonPath -Action Allow -Profile Any -Enabled True

Write-Host "Firewall rule added successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "You should now be able to access Beamer+ from other devices on your network." -ForegroundColor Green
