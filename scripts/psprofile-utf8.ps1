# Ensures any Set-Content/Out-File/WriteAllText defaults to UTF-8 (no BOM)
$PSDefaultParameterValues["*:Encoding"] = "utf8"
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)
