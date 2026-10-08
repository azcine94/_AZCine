param([string]$InstallDirectory, [string]$IsolatedUserDirectory)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$utf8=New-Object Text.UTF8Encoding($true)
$source=$PSScriptRoot
$created=New-Object 'Collections.Generic.List[string]'

function Write-Text([string]$Path,[string]$Text) {
    $parent=Split-Path $Path
    if(-not(Test-Path -LiteralPath $parent)){$null=New-Item -ItemType Directory -Path $parent -Force}
    [IO.File]::WriteAllText($Path,$Text,$utf8)
}
function Is-Inside([string]$Path,[string]$Root) {
    return $Path.Equals($Root,[StringComparison]::OrdinalIgnoreCase) -or $Path.StartsWith($Root.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)
}
function Replace-Paths($Value,$Mappings) {
    if($null -eq $Value){return $null}
    if($Value -is [string]){
        foreach($mapping in $Mappings){$Value=$Value.Replace($mapping.token,$mapping.path)}
        return $Value
    }
    if($Value -is [ValueType]){return $Value}
    if($Value -is [Collections.IEnumerable] -and $Value -isnot [pscustomobject]){
        $items=@();foreach($item in $Value){$items+=,(Replace-Paths $item $Mappings)};return ,$items
    }
    foreach($property in $Value.PSObject.Properties){$property.Value=Replace-Paths $property.Value $Mappings}
    return $Value
}
try {
    if(-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') {throw '此环境包仅支持 Windows x64。'}
    # Explicit integration-test destination; never substitute registry-known folders implicitly.
    $userDirectory=$env:USERPROFILE
    $documents=[Environment]::GetFolderPath('MyDocuments')
    $desktop=[Environment]::GetFolderPath('Desktop')
    $roaming=$env:APPDATA
    if($IsolatedUserDirectory){
        if(-not [IO.Path]::IsPathRooted($IsolatedUserDirectory)){throw '隔离用户目录必须是绝对路径。'}
        $userDirectory=[IO.Path]::GetFullPath($IsolatedUserDirectory).TrimEnd('\')
        if($userDirectory.Equals($env:USERPROFILE,[StringComparison]::OrdinalIgnoreCase)){throw '隔离目录不能是当前用户真实目录。'}
        $documents=Join-Path $userDirectory 'Documents';$desktop=Join-Path $userDirectory 'Desktop';$roaming=Join-Path $userDirectory 'AppData\Roaming'
    }
    $default=Join-Path $userDirectory 'AZCineDevEnvironment'
    if(-not $InstallDirectory){
        $answer=Read-Host "部署到哪里？直接回车使用 $default"
        $InstallDirectory=if($answer){$answer.Trim('"')}else{$default}
    }
    if(-not [IO.Path]::IsPathRooted($InstallDirectory)){throw '请填写完整的安装目录。'}
    $target=[IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\')
    if((Is-Inside $target $source) -or (Is-Inside $source $target)){throw '安装目录与解压目录不能互相包含，请另选目录。'}
    if(Test-Path -LiteralPath $target){throw "目标目录已存在，未覆盖任何内容。请选一个新目录：$target"}
    $herdrConfig=Join-Path $roaming 'herdr'
    $payload=Join-Path $source 'payload'
    $manifestPath=Join-Path $source 'manifest.json'
    if(-not(Test-Path -LiteralPath $manifestPath)){throw '解压包不完整：缺少 manifest.json。'}
    # Windows PowerShell 5.1's ConvertFrom-Json becomes prohibitively slow for
    # tens of thousands of entries. Use the framework parser for this flat manifest.
    Add-Type -AssemblyName System.Web.Extensions
    $serializer=New-Object Web.Script.Serialization.JavaScriptSerializer
    $serializer.MaxJsonLength=[int]::MaxValue
    $manifest=$serializer.DeserializeObject([IO.File]::ReadAllText($manifestPath))
    if($manifest.format -ne 1 -or $manifest.platform -ne 'windows-x64'){throw '环境包格式不支持。'}
    Write-Host '正在核对包内文件…'
    $checked=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $verified=0
    $hasher=[Security.Cryptography.SHA256]::Create()
    try { foreach($file in $manifest.files){
        $relative=[string]$file.path
        if($relative -match '(^[/\\]|:|(^|[/\\])\.\.([/\\]|$))'){throw '环境包存在不安全路径。'}
        $path=[IO.Path]::GetFullPath((Join-Path $source $relative))
        if(-not(Is-Inside $path $source) -or -not $checked.Add($path)){throw '环境包路径重复或越界。'}
        $item=New-Object IO.FileInfo($path)
        if(-not $item.Exists){throw "文件缺失：$relative"}
        if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw '环境包不允许使用文件链接。'}
        if($item.Length -ne $file.bytes){throw "文件不完整或已改变：$relative"}
        $stream=[IO.File]::OpenRead($path)
        try {$hash=[BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-','')} finally {$stream.Dispose()}
        if($hash -ne $file.sha256){throw "文件不完整或已改变：$relative"}
        $verified++
        if(($verified % 2000) -eq 0){Write-Host "已核对 $verified / $($manifest.files.Count) 个文件"}
    } } finally {$hasher.Dispose()}
    # Only manifest-listed payload files can be installed, never arbitrary adjacent files.
    $payloadFiles=@($manifest.files | Where-Object {$_.path.StartsWith('payload/')})
    foreach($required in @('payload/herdr/herdr.exe','payload/tools/node/node.exe','payload/tools/git/bin/bash.exe','payload/openpi/agent/settings.json','start-environment.ps1')){
        if(-not $checked.Contains([IO.Path]::GetFullPath((Join-Path $source $required)))){throw "环境包缺少必要文件：$required"}
    }
    $profilePlans=@()
    $launcher=(Join-Path $target 'start-environment.ps1').Replace("'","''")
    $shell=if(Test-Path -LiteralPath (Join-Path $payload 'tools\powershell\pwsh.exe')){Join-Path $target 'tools\powershell\pwsh.exe'}else{Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'}
    $escapedShell=$shell.Replace("'","''")
    $block=@"
# BEGIN AZCINE DEV ENVIRONMENT
function global:opi { & '$escapedShell' -NoProfile -ExecutionPolicy Bypass -File '$launcher' -Tool opi @args }
function global:herdr { & '$escapedShell' -NoProfile -ExecutionPolicy Bypass -File '$launcher' -Tool herdr @args }
# END AZCINE DEV ENVIRONMENT
"@
    foreach($folder in @('WindowsPowerShell','PowerShell')){
        foreach($name in @('profile.ps1','Microsoft.PowerShell_profile.ps1')){
            $path=Join-Path (Join-Path $documents $folder) $name
            $old=if(Test-Path -LiteralPath $path){[IO.File]::ReadAllText($path)}else{''}
            if($old -match '(?im)function\s+(global:)?(opi|herdr)\b|(?:Set-Alias|New-Alias)\s+(?:-Name\s+)?(opi|herdr)\b|BEGIN AZCINE DEV ENVIRONMENT'){
                throw "已有 opi / herdr 启动设置，未覆盖。请先处理冲突：$path"
            }
            if($name -eq 'profile.ps1'){
                $next=$old.TrimEnd()+"`r`n"+$block+"`r`n"
                $tokens=$null;$parseErrors=$null
                $null=[Management.Automation.Language.Parser]::ParseInput($next,[ref]$tokens,[ref]$parseErrors)
                if($parseErrors.Count){throw "PowerShell 配置存在语法问题，未修改：$path"}
                $profilePlans+=@{path=$path;old=$old;next=$next;existed=(Test-Path -LiteralPath $path)}
            }
        }
    }
    foreach($file in $payloadFiles | Where-Object {$_.path.StartsWith('payload/herdr-config/')}){
        $destination=Join-Path $herdrConfig $file.path.Substring('payload/herdr-config/'.Length)
        if(Test-Path -LiteralPath $destination){throw "已有 Herdr 设置或插件，未覆盖。请先处理冲突：$destination"}
    }
    $shortcut=Join-Path $desktop 'AZCine 开发环境.lnk'
    if(Test-Path -LiteralPath $shortcut){throw "桌面已有同名快捷方式，未覆盖：$shortcut"}
    $null=New-Item -ItemType Directory -Path $target
    $created.Add($target)
    Write-Text (Join-Path $target 'DEPLOY-INCOMPLETE.txt') '部署尚未完成；失败时保留文件，不自动删除。'
    $mappings=@(
        @{token='__AZCINE_OPENPI__';path=(Join-Path $target 'openpi')},
        @{token='__AZCINE_HERDR_CONFIG__';path=$herdrConfig},
        @{token='__AZCINE_HERDR__';path=(Join-Path $target 'herdr')}
    )
    Write-Host '正在恢复程序与个人配置…'
    $copied=0
    foreach($file in $payloadFiles){
        $isConfig=$file.path.StartsWith('payload/herdr-config/')
        $relative=$file.path.Substring('payload/'.Length)
        $destination=if($isConfig){Join-Path $herdrConfig $file.path.Substring('payload/herdr-config/'.Length)}else{Join-Path $target $relative}
        $original=Join-Path $source $file.path
        $parent=Split-Path $destination
        $null=[IO.Directory]::CreateDirectory($parent)
        if([IO.File]::Exists($destination) -or [IO.Directory]::Exists($destination)){throw "部署时出现文件冲突，已停止：$destination"}
        [IO.File]::Copy($original,$destination,$false)
        $copied++
        if(($copied % 2000) -eq 0){Write-Host "已恢复 $copied / $($payloadFiles.Count) 个文件"}
        if($isConfig){$created.Add($destination)}
        if($file.mode -in @('json','text')){
            $extension=[IO.Path]::GetExtension($destination)
            if($extension -eq '.json'){
                $value=Get-Content -LiteralPath $destination -Raw | ConvertFrom-Json
                Write-Text $destination ((Replace-Paths $value $mappings) | ConvertTo-Json -Depth 100)
            } elseif($extension -in @('.ts','.js','.mjs','.cjs','.md','.toml','.ps1','.cmd','.yaml','.yml')){
                $text=[IO.File]::ReadAllText($destination)
                foreach($mapping in $mappings){$text=$text.Replace($mapping.token,$mapping.path)}
                Write-Text $destination $text
            }
        }
    }
    [IO.File]::Copy((Join-Path $source 'start-environment.ps1'),(Join-Path $target 'start-environment.ps1'),$false)
    $settingsPath=Join-Path $target 'openpi\agent\settings.json'
    $settings=Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
    foreach($package in @($settings.packages)){
        if($package -is [string]){continue}
        if($package.source -match '[\\/]node_modules[\\/]@tt-a1i[\\/]openpi[\\/]?$'){$package.source='..\runtime\node_modules\@tt-a1i\openpi'}
    }
    $settings.packages=@($settings.packages | ForEach-Object {if($_ -is [string] -and $_ -match '[\\/]node_modules[\\/]@tt-a1i[\\/]openpi[\\/]?$'){'..\runtime\node_modules\@tt-a1i\openpi'}else{$_}})
    Write-Text $settingsPath ($settings | ConvertTo-Json -Depth 100)
    $null=New-Item -ItemType Directory -Path (Join-Path $target 'workspace') -Force
    foreach($plan in $profilePlans){
        $now=if(Test-Path -LiteralPath $plan.path){[IO.File]::ReadAllText($plan.path)}else{''}
        if($now -cne $plan.old -or (Test-Path -LiteralPath $plan.path) -ne $plan.existed){throw "配置在部署期间改变，已停止：$($plan.path)"}
        if($plan.existed){[IO.File]::Copy($plan.path,($plan.path+'.azcine-backup-'+[Guid]::NewGuid().ToString('N')),$false)}
        Write-Text $plan.path $plan.next
        $created.Add($plan.path)
    }
    $wsh=New-Object -ComObject WScript.Shell
    if(-not(Test-Path -LiteralPath $desktop)){$null=New-Item -ItemType Directory -Path $desktop -Force}
    $link=$wsh.CreateShortcut($shortcut)
    $link.TargetPath=$shell
    $link.Arguments='-NoExit -ExecutionPolicy Bypass -File "'+(Join-Path $target 'start-environment.ps1')+'" -Tool herdr'
    $link.WorkingDirectory=Join-Path $target 'workspace'
    $link.Save()
    $created.Add($shortcut)
    Write-Text (Join-Path $target 'deployment.json') (@{completedAt=[DateTime]::UtcNow.ToString('o');created=@($created.ToArray())}|ConvertTo-Json -Depth 5)
    [IO.File]::Delete((Join-Path $target 'DEPLOY-INCOMPLETE.txt'))
    Write-Host "部署完成：$target" -ForegroundColor Green
    Write-Host '从桌面 AZCine 开发环境打开 Herdr；新开 PowerShell 后可输入 opi / herdr。'
    Write-Host '待你处理：认证、Skills 软链接。Codex 安装命令：npm install -g @openai/codex（在部署后的终端执行）。'
    Write-Host '若系统策略不加载 PowerShell 配置，请使用桌面入口；没有修改全局 PATH 或系统执行策略。'
} catch {
    Write-Host ('部署未完成：'+$_.Exception.Message) -ForegroundColor Red
    if($created.Count){Write-Host '已创建的内容保留，不自动覆盖或清理：';$created | ForEach-Object {Write-Host $_}}
    exit 1
}
