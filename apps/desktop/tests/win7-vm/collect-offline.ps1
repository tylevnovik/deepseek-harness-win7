<# Retrieve only this run's diagnostics after the owned validation VM is off. #>
param([Parameter(Mandatory=$true)][string]$ConfigPath)
$ErrorActionPreference='Stop'
$config=Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$runRoot=[IO.Path]::GetFullPath($config.runRoot)
if(!$runRoot.StartsWith('D:\VMs\Win7\validation-runs\',[StringComparison]::OrdinalIgnoreCase)){throw 'Invalid run root'}
Import-Module Hyper-V
$owner=Get-Content -LiteralPath 'D:\VMs\Win7\validation-vm\owner.json' -Raw | ConvertFrom-Json
$vm=Get-VM -Name 'ZCode-Win7-Validation'
if($vm.Id.ToString() -ne $owner.vmId -or $vm.State -ne 'Off'){throw 'Owned validation VM must be off'}
$vhd='D:\VMs\Win7\validation-vm\data.vhdx'
try {
    $disk=Mount-VHD -Path $vhd -ReadOnly -PassThru | Get-Disk
    $partition=Get-Partition -DiskNumber $disk.Number | Where-Object {$_.Size -gt 100MB} | Sort-Object Size -Descending | Select-Object -First 1
    if(!$partition.DriveLetter){Add-PartitionAccessPath -InputObject $partition -AssignDriveLetter;$partition=Get-Partition -DiskNumber $disk.Number -PartitionNumber $partition.PartitionNumber}
    $root=Join-Path ("$($partition.DriveLetter):\") ('dsh-validation-'+$config.runId)
    $profile=Join-Path $root ('profiles\'+$config.runId)
    $files=@()
    foreach($relative in @('runner.log',('profiles\'+$config.runId+'\diagnostics\probe-report.json'),('profiles\'+$config.runId+'\diagnostics\headless-stderr.log'),('profiles\'+$config.runId+'\desktop\desktop.log'))) {
        $path=Join-Path $root $relative
        if(Test-Path -LiteralPath $path){$files+=@{name=$relative;text=[string](Get-Content -LiteralPath $path -Raw)}}
    }
    $files | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $runRoot 'offline-files.json') -Encoding UTF8
} finally {Dismount-VHD -Path $vhd}
