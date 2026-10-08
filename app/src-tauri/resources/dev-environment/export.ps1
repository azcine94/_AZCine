param([Parameter(Mandatory=$true)][string]$RequestFile, [Parameter(Mandatory=$true)][string]$ProgressFile)
. (Join-Path $PSScriptRoot 'common.ps1')
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$script:Entries = New-Object 'Collections.Generic.List[object]'
$script:EntryNames = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
$script:Mappings = @()
$script:Omitted = New-Object 'Collections.Generic.List[string]'
$script:Output = ''

function Progress([string]$Message, [int]$Done=0, [int]$Total=0) {
    Write-Json $ProgressFile @{ message=$Message; done=$Done; total=$Total }
}
function Portable-Text([string]$Text) {
    foreach ($mapping in $script:Mappings) {
        # Values are transformed after JSON parsing, so no JSON escaping is involved.
        $Text = [regex]::Replace($Text, [regex]::Escape($mapping.from), [string]$mapping.to, [Text.RegularExpressions.RegexOptions]::IgnoreCase)
        $Text = [regex]::Replace($Text, [regex]::Escape($mapping.from.Replace('\','/')), [string]$mapping.to, [Text.RegularExpressions.RegexOptions]::IgnoreCase)
    }
    return $Text
}
function Clean-Json($Value) {
    if ($null -eq $Value) { return $null }
    if ($Value -is [string]) {
        # Configuration may put credentials in URL query strings or userinfo.
        if ($Value -match '(?i)([?&](key|token|api_key|apikey|secret|password)=|://[^/\s]+:[^/\s]+@|\bBearer\s+\S+)') { return '' }
        return Portable-Text $Value
    }
    if ($Value -is [ValueType]) { return $Value }
    if ($Value -is [Collections.IEnumerable] -and $Value -isnot [pscustomobject]) {
        $result = @(); foreach($item in $Value) { $result += ,(Clean-Json $item) }; return ,$result
    }
    $result = [ordered]@{}
    foreach($property in $Value.PSObject.Properties) {
        if ($property.Name -match '(?i)(api.?key|secret|password|credential|authorization|authHeader|private.?key|cookie)|^(access.?token|refresh.?token|token|headers|env)$') { continue }
        $result[$property.Name] = Clean-Json $property.Value
    }
    return $result
}
function Add-Entry([string]$Source, [string]$Name, [string]$Mode='raw') {
    $Name = $Name.Replace('\','/')
    if (-not $script:EntryNames.Add($Name)) { throw "打包路径重复：$Name" }
    $script:Entries.Add([pscustomobject]@{source=$Source;name=$Name;mode=$Mode})
}
function Add-Generated([string]$Name, [string]$Text) {
    if (-not $script:EntryNames.Add($Name)) { throw "打包路径重复：$Name" }
    $script:Entries.Add([pscustomobject]@{source=$null;name=$Name;mode='generated';text=$Text})
}
function Secret-File([string]$Name) {
    return $Name -match '(?i)^(auth\.json|models-store\.json|\.env($|\.)|\.npmrc$|\.gitconfig$|credentials($|\.)|id_(rsa|ed25519)|.*\.(pem|key|pfx|p12)$)'
}
function Add-Tree([string]$Source, [string]$Destination, [string]$Mode='raw') {
    $root = Get-Item -LiteralPath $Source
    if ($root.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "源目录包含链接，请选择实际目录：$Source" }
    $pending = New-Object 'Collections.Generic.Stack[object]'
    $pending.Push(@($Source,$Destination))
    while($pending.Count) {
        $pair = $pending.Pop()
        $children=@(Get-ChildItem -LiteralPath $pair[0] -Force)
        if($Mode -eq 'skills' -and $children.Count -eq 0){Add-Entry '' (($pair[1]+'/').Replace('\','/')) 'directory'}
        foreach($item in $children) {
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "目录中有需要单独处理的链接：$($item.FullName)" }
            $name = ($pair[1] + '/' + $item.Name).Replace('\','/')
            if ($Mode -ne 'skills' -and $item.Name -eq '.git') { continue }
            if ($Mode -eq 'config' -or $Mode -eq 'plugin') {
                if (Secret-File $item.Name) { $script:Omitted.Add($name); continue }
                if ($item.Name -match '(?i)^(\.git|sessions|web-sessions|cache|\.cache|logs|backups|workspace|worktrees|\.openpi-git-review-baselines)$' -or $item.Name -match '(?i)(\.log|\.tmp|\.part|\.lock|\.bak(-.*)?)$') { continue }
            }
            if($Mode -eq 'plugin' -and ($name -match '/target/(debug|doc|build|deps|incremental)(/|$)|/target/release/(build|deps|incremental|examples)(/|$)' -or $item.Extension -in @('.pdb','.rlib','.rmeta','.d'))){continue}
            if ($item.PSIsContainer) { $pending.Push(@($item.FullName,$name)) }
            else { Add-Entry $item.FullName $name $(if($Mode -in @('config','plugin') -and $item.Extension -eq '.json'){'json'}elseif($Mode -in @('config','plugin') -and $item.Extension -in @('.ts','.js','.mjs','.cjs','.md','.toml','.ps1','.cmd','.yaml','.yml')){'text'}else{'raw'}) }
        }
    }
}
function Config-Text([string]$Source) {
    $text = [IO.File]::ReadAllText($Source)
    # Do not publish obvious inline credentials in hand-written extensions or TOML.
    # Only the filename is reported. Authentication files are excluded without reading them.
    if ($text -match '(?im)(?:api[_-]?key|password|secret|access[_-]?token)\s*[:=]\s*["''][^"''\r\n]{8,}["'']' -or $text -match '-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----') {
        throw "自定义文件包含疑似内嵌凭据，请先移到认证配置后再打包：$Source"
    }
    return Portable-Text $text
}
function Write-Zip([string]$Path, [object[]]$Entries, [string]$Label) {
    $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $zip = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Create, $false)
    $hashes = New-Object 'Collections.Generic.List[object]'
    $count=0
    try {
        foreach($item in $Entries) {
            if (($count % 40) -eq 0) { Progress $Label $count $Entries.Count }
            $entry = $zip.CreateEntry($item.name, [IO.Compression.CompressionLevel]::Fastest)
            if($item.mode -eq 'directory'){$count++;continue}
            $destination = $entry.Open(); $inputStream=$null; $sha=[Security.Cryptography.SHA256]::Create()
            try {
                if ($item.mode -eq 'generated') { $bytes=if($item.name.EndsWith('.cmd')){[Text.Encoding]::ASCII.GetBytes($item.text)}else{$script:Utf8.GetPreamble()+$script:Utf8.GetBytes($item.text)}; $inputStream=New-Object IO.MemoryStream(,$bytes) }
                elseif ($item.mode -eq 'json') { $text=(Clean-Json (Read-Json $item.source)) | ConvertTo-Json -Depth 100; $bytes=$script:Utf8.GetPreamble()+$script:Utf8.GetBytes($text); $inputStream=New-Object IO.MemoryStream(,$bytes) }
                elseif ($item.mode -eq 'text') { $bytes=$script:Utf8.GetPreamble()+$script:Utf8.GetBytes((Config-Text $item.source)); $inputStream=New-Object IO.MemoryStream(,$bytes) }
                else { $inputStream=[IO.File]::Open($item.source,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read) }
                $buffer=New-Object byte[] 131072; $length=0L
                while(($read=$inputStream.Read($buffer,0,$buffer.Length)) -gt 0) {
                    $destination.Write($buffer,0,$read); $null=$sha.TransformBlock($buffer,0,$read,$buffer,0); $length+=$read
                }
                $null=$sha.TransformFinalBlock((New-Object byte[] 0),0,0)
                $hashes.Add(@{path=$item.name;bytes=$length;mode=$item.mode;sha256=([BitConverter]::ToString($sha.Hash).Replace('-','').ToLowerInvariant())})
            } finally { if($inputStream){$inputStream.Dispose()}; $destination.Dispose(); $sha.Dispose() }
            $count++
        }
        # The deployment script checks every payload before changing the target computer.
        if ($Label -eq '正在打包开发环境') {
            $entry=$zip.CreateEntry('manifest.json'); $destination=$entry.Open()
            try { $bytes=$script:Utf8.GetBytes((@{format=1;platform='windows-x64';createdAt=[DateTime]::UtcNow.ToString('o');files=@($hashes.ToArray())} | ConvertTo-Json -Depth 10)); $destination.Write($bytes,0,$bytes.Length) }
            finally { $destination.Dispose() }
        }
    } finally { $zip.Dispose(); $stream.Dispose() }
    Progress $Label $count $Entries.Count
}

try {
    $request=Read-Json $RequestFile
    $snapshot=Discover $request.paths
    if (-not $snapshot.ready) { throw ($snapshot.issues -join ' ') }
    $output=Full-Path $request.output
    if (-not (Test-Path -LiteralPath $output -PathType Container)) { throw '保存目录不存在，请重新选择。' }
    foreach($root in @($snapshot.paths.herdr,$snapshot.paths.openpi,$snapshot.paths.skills,$snapshot.dependencies.node,$snapshot.dependencies.git,$snapshot.dependencies.powershell,$snapshot.herdrConfig)) {
        if ($root -and (Inside $output (Full-Path $root))) { throw '保存位置不能放在本次打包的源目录内。' }
    }
    $script:Output=Join-Path $output ('azcine-dev-'+[DateTime]::Now.ToString('yyyyMMdd-HHmmss')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,8))
    $null=New-Item -ItemType Directory -Path $script:Output
    [IO.File]::WriteAllText((Join-Path $script:Output 'INCOMPLETE.txt'),'打包尚未完成。若任务失败或被取消，保留此目录供核对，请勿用于部署。',$script:Utf8)
    Progress '正在收集当前环境'
    $script:Mappings=@(
        @{from=$snapshot.runtime;to='__AZCINE_OPENPI__\runtime'},
        @{from=$snapshot.paths.openpi;to='__AZCINE_OPENPI__'},
        @{from=$snapshot.herdrConfig;to='__AZCINE_HERDR_CONFIG__'},
        @{from=$snapshot.paths.herdr;to='__AZCINE_HERDR__'}
    )
    Add-Tree $snapshot.paths.herdr 'payload/herdr'
    Add-Tree $snapshot.runtime 'payload/openpi/runtime'
    Add-Tree $snapshot.dependencies.node 'payload/tools/node'
    Add-Tree $snapshot.dependencies.git 'payload/tools/git'
    if ($snapshot.dependencies.powershell) {
        $verifiedPowerShell = PowerShell-Directory $snapshot.dependencies.powershell
        if (-not $verifiedPowerShell.Equals($snapshot.dependencies.powershell,[StringComparison]::OrdinalIgnoreCase)) { throw 'PowerShell 安装目录在收集期间发生变化，请重新识别后打包。' }
        Add-Tree $verifiedPowerShell 'payload/tools/powershell'
    }
    $bin=Join-Path $snapshot.paths.openpi 'bin'
    if(Test-Path -LiteralPath $bin){Add-Tree $bin 'payload/openpi/bin'}
    $agent=Join-Path $snapshot.paths.openpi 'agent'
    foreach($name in @('settings.json','models.json','mcp.json','my-pi-setup.json')) {
        $source=Join-Path $agent $name
        if(Test-Path -LiteralPath $source){Add-Entry $source ('payload/openpi/agent/'+$name) 'json'}
    }
    foreach($name in @('extensions','packages','prompts','themes','agents','workflows')) {
        $source=Join-Path $agent $name
        if(Test-Path -LiteralPath $source){Add-Tree $source ('payload/openpi/agent/'+$name) 'config'}
    }
    foreach($name in @('APPEND_SYSTEM.md','SYSTEM.md','AGENTS.md')) {
        $source=Join-Path $agent $name
        if(Test-Path -LiteralPath $source){Add-Entry $source ('payload/openpi/agent/'+$name) 'text'}
    }
    foreach($name in @('config.toml','plugins.json')) {
        $source=Join-Path $snapshot.herdrConfig $name
        if(Test-Path -LiteralPath $source){Add-Entry $source ('payload/herdr-config/'+$name) $(if($name.EndsWith('.json')){'json'}else{'text'})}
    }
    foreach($name in @('agent-detection','plugins')) {
        $source=Join-Path $snapshot.herdrConfig $name
        if(Test-Path -LiteralPath $source){Add-Tree $source ('payload/herdr-config/'+$name) 'plugin'}
    }
    # Generate fresh entry points; old export/setup/start scripts are never copied or executed.
    Add-Generated 'deploy.ps1' ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'deploy.ps1')))
    Add-Generated 'deploy.cmd' "@echo off`r`npowershell.exe -NoProfile -ExecutionPolicy Bypass -File `"%~dp0deploy.ps1`" %*`r`nset DEPLOY_RESULT=%errorlevel%`r`nif not %DEPLOY_RESULT%==0 echo Deployment did not complete.`r`npause`r`nexit /b %DEPLOY_RESULT%`r`n"
    Add-Generated 'start-environment.ps1' ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'start-environment.ps1')))
    Add-Generated 'versions.json' ($snapshot.versions | ConvertTo-Json -Depth 5)
    Add-Generated 'README.txt' "开发环境迁移包（Windows x64）`r`n`r`n1. 完整解压后双击 deploy.cmd。新电脑不需要 AZCine。`r`n2. 默认部署到用户目录 AZCineDevEnvironment，可指定其他空目录。已有文件冲突会停止，不覆盖。`r`n3. 部署后从桌面 AZCine 开发环境启动 Herdr，或新开 PowerShell 输入 opi / herdr。`r`n4. 账号和 API Key 不包含在包内，请在新电脑配置。自定义额度查询、代理和 MCP 服务也可能需要配置。`r`n5. Skills 在独立 skills-manager.zip；解压后自己软链到 ~/.pi/agent/skills。`r`n6. Codex 未迁移。部署后的终端执行：npm install -g @openai/codex，然后运行 codex。`r`n`r`n包不带项目、历史会话、宿主认证，不自动升级。可复用扩展内的非标准凭据无法保证自动识别，请勿公开分享个人环境包。`r`n"
    $environmentEntries=@($script:Entries.ToArray())
    $script:Entries.Clear();$script:EntryNames.Clear()
    Add-Tree $snapshot.paths.skills 'skills-manager' 'skills'
    $skillEntries=@($script:Entries.ToArray())
    Write-Zip (Join-Path $script:Output 'dev-environment.zip.partial') $environmentEntries '正在打包开发环境'
    Write-Zip (Join-Path $script:Output 'skills-manager.zip.partial') $skillEntries '正在打包 Skills'
    [IO.File]::Move((Join-Path $script:Output 'dev-environment.zip.partial'),(Join-Path $script:Output 'dev-environment.zip'))
    [IO.File]::Move((Join-Path $script:Output 'skills-manager.zip.partial'),(Join-Path $script:Output 'skills-manager.zip'))
    $result=@{output=$script:Output;files=@('dev-environment.zip','skills-manager.zip');excluded=@($script:Omitted.ToArray())}
    Write-Json (Join-Path $script:Output 'export-result.json') $result
    # Only remove the marker created in this invocation; never clean sources or old exports.
    [IO.File]::Delete((Join-Path $script:Output 'INCOMPLETE.txt'))
    Write-Json (Join-Path $PSScriptRoot 'result.json') $result
} catch {
    $message=$_.Exception.Message
    if($script:Output){$message+=" 未完成的输出保留在：$script:Output"}
    [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'error.txt'),$message,$script:Utf8)
    exit 1
}
