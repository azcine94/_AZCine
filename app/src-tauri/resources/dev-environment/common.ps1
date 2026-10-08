# Shared by the embedded discovery/export workers. Never dot-source user profiles.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$script:Utf8 = New-Object Text.UTF8Encoding($true)

function Read-Json([string]$Path) {
    try { return [IO.File]::ReadAllText($Path) | ConvertFrom-Json }
    catch { throw "无法解析配置文件：$Path" }
}
function Write-Json([string]$Path, $Value) {
    [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 100), $script:Utf8)
}
function Full-Path([string]$Path) {
    if (-not $Path -or -not [IO.Path]::IsPathRooted($Path)) { throw '请选择完整的本机目录路径。' }
    $full = [IO.Path]::GetFullPath($Path)
    if ($full.TrimEnd('\','/') -eq [IO.Path]::GetPathRoot($full).TrimEnd('\','/')) { throw '请选择具体文件夹，不能使用整个磁盘根目录。' }
    return $full.TrimEnd('\', '/')
}
function Inside([string]$Path, [string]$Root) {
    return $Path.Equals($Root, [StringComparison]::OrdinalIgnoreCase) -or $Path.StartsWith($Root.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)
}
function Command-File([string]$Name) {
    $command = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { return $command.Source }
    return ''
}
function Real-Directory([string]$Path) {
    $item = Get-Item -LiteralPath $Path -ErrorAction Stop
    for ($i=0; $i -lt 8 -and $item.LinkType; $i++) {
        $target = @($item.Target)[0]
        if (-not [IO.Path]::IsPathRooted($target)) { $target = Join-Path $item.Parent.FullName $target }
        $item = Get-Item -LiteralPath $target -ErrorAction Stop
    }
    if (-not $item.PSIsContainer -or $item.LinkType) { throw "不能识别实际目录：$Path" }
    return $item.FullName
}
function Discover($InputPaths) {
    $issues = New-Object 'Collections.Generic.List[string]'
    $warnings = New-Object 'Collections.Generic.List[string]'
    if(-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { $issues.Add('当前仅支持打包 Windows x64 环境。') }
    $herdr = [string]$InputPaths.herdr
    if (-not $herdr) {
        $exe = Command-File 'herdr.exe'
        if ($exe) { $herdr = Split-Path $exe }
        else { $herdr = Join-Path $env:USERPROFILE '.herdr\packages\standalone\current' }
    }
    if (Test-Path -LiteralPath $herdr -PathType Container) { $herdr = Real-Directory $herdr }
    $openpi = [string]$InputPaths.openpi
    if (-not $openpi) { $openpi = Join-Path $env:USERPROFILE 'OpenPI-Sandbox' }
    $skills = [string]$InputPaths.skills
    if (-not $skills) { $skills = 'E:\skills-manager' }
    $paths = [ordered]@{ herdr=(Full-Path $herdr); openpi=(Full-Path $openpi); skills=(Full-Path $skills) }
    foreach ($name in @('herdr','openpi','skills')) {
        if (-not (Test-Path -LiteralPath $paths[$name] -PathType Container)) { $issues.Add("找不到 $name 目录，请修改路径。") }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $herdr 'herdr.exe') -PathType Leaf)) { $issues.Add('Herdr 目录中缺少 herdr.exe。') }
    if (-not (Test-Path -LiteralPath (Join-Path $herdr 'conpty') -PathType Container)) { $issues.Add('Herdr 目录中缺少 conpty 运行文件。') }
    $agent = Join-Path $openpi 'agent'
    $settingsPath = Join-Path $agent 'settings.json'
    $runtime = ''; $openpiPackage = ''; $openpiVersion = ''; $piVersion = ''
    if (Test-Path -LiteralPath $settingsPath -PathType Leaf) {
        $settings = Read-Json $settingsPath
        foreach ($package in @($settings.packages)) {
            $source = if ($package -is [string]) { $package } else { [string]$package.source }
            if ($source -match '[\\/]node_modules[\\/]@tt-a1i[\\/]openpi[\\/]?$') {
                if (-not [IO.Path]::IsPathRooted($source)) { $source = Join-Path $agent $source }
                $openpiPackage = Full-Path $source
                $runtime = Split-Path (Split-Path (Split-Path $openpiPackage))
            } elseif ($source) {
                $issues.Add('发现额外的 OpenPI 包来源；当前打包器只支持所选本地 OpenPI 运行库，请先整理到自定义扩展目录。')
            }
        }
        if (-not $runtime) { $issues.Add('当前 OpenPI 配置没有可打包的本地运行库路径，请选择正在使用的 OpenPI-Sandbox 目录。') }
    } else { $issues.Add('OpenPI 目录中缺少 agent/settings.json。') }
    if ($runtime) {
        if (-not (Inside $runtime $paths.openpi)) { $issues.Add('OpenPI 运行库位于所选目录之外，暂不能完整打包。') }
        $piManifest = Join-Path $runtime 'node_modules\@earendil-works\pi-coding-agent\package.json'
        $openpiManifest = Join-Path $openpiPackage 'package.json'
        if ((Test-Path -LiteralPath $piManifest) -and (Test-Path -LiteralPath $openpiManifest)) {
            $pi = Read-Json $piManifest; $op = Read-Json $openpiManifest
            $piVersion = [string]$pi.version; $openpiVersion = [string]$op.version
        } else { $issues.Add('当前 OpenPI / Pi 运行库不完整。') }
    }
    $node = Command-File 'node.exe'
    $git = Command-File 'git.exe'
    $pwsh = Command-File 'pwsh.exe'
    $gitRoot = if ($git) { Split-Path (Split-Path $git) } else { '' }
    if (-not $node) { $issues.Add('未找到当前 Node.js，请先安装或让启动 AZCine 的终端能找到 node。') }
    if (-not $gitRoot -or -not (Test-Path -LiteralPath (Join-Path $gitRoot 'bin\bash.exe'))) { $issues.Add('未找到完整的 Git for Windows（需要 Git 与 Bash）。') }
    $nodeRoot = if ($node) { Split-Path $node } else { '' }
    $pwshRoot = if ($pwsh) { Split-Path $pwsh } else { '' }
    if($pwsh -and -not(Test-Path -LiteralPath (Join-Path $pwshRoot 'System.Management.Automation.dll'))){
        $package=Get-AppxPackage -Name Microsoft.PowerShell -ErrorAction SilentlyContinue | Select-Object -First 1
        if($package -and (Test-Path -LiteralPath (Join-Path $package.InstallLocation 'pwsh.exe'))){$pwshRoot=$package.InstallLocation}
    }
    if ($pwsh -and -not (Test-Path -LiteralPath (Join-Path $pwshRoot 'System.Management.Automation.dll'))) {
        $issues.Add('PowerShell 7 入口不是实际安装目录，请从能找到完整 pwsh 安装的终端启动 AZCine。')
    }
    $warnings.Add('账号、Key、项目、历史会话不打包；新电脑自行配置认证和 Skills 链接。')
    $warnings.Add('自定义扩展涉及的代理、外部服务和目录，部署后仍需按新电脑情况配置。')
    return [ordered]@{
        paths=$paths
        versions=[ordered]@{herdr=(Split-Path $herdr -Leaf); openpi=$openpiVersion; pi=$piVersion; node=$(if($node){(Get-Item -LiteralPath $node).VersionInfo.ProductVersion}else{''})}
        dependencies=[ordered]@{node=$nodeRoot; git=$gitRoot; powershell=$pwshRoot}
        runtime=$runtime; openpiPackage=$openpiPackage; herdrConfig=(Join-Path $env:APPDATA 'herdr')
        issues=@($issues.ToArray()); warnings=@($warnings.ToArray()); ready=($issues.Count -eq 0)
    }
}
