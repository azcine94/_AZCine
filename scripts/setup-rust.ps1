$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$env:RUSTUP_HOME = Join-Path $Root '.tooling/rustup'
$env:CARGO_HOME = Join-Path $Root '.tooling/cargo'
$Installer = Join-Path $Root '.tooling/downloads/rustup-init-1.29.1.exe'
$Expected = '6f4bef66261261fcb43131be8720bab817d403a09edec7455c371974b90bdb7e'
if (-not (Test-Path $Installer)) {
    throw 'Download the official Rustup 1.29.1 Windows MSVC installer into .tooling/downloads first. See README.'
}
if ((Get-FileHash -Algorithm SHA256 $Installer).Hash.ToLowerInvariant() -ne $Expected) {
    throw 'Rustup installer checksum differs from the reviewed official release. Not executing.'
}
& $Installer -y --profile minimal --no-modify-path --default-host x86_64-pc-windows-msvc --default-toolchain 1.99.0
exit $LASTEXITCODE
