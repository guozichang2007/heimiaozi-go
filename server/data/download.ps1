$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$dir = $PSScriptRoot
function dl($url, $out) {
  Write-Output "Downloading $url -> $out"
  Invoke-WebRequest -Uri $url -OutFile $out -MaximumRedirection 5
  Write-Output "Done: $out"
}
dl 'https://github.com/lightvector/KataGo/releases/download/v1.18.1/katago-v1.18.1-cuda12.5-cudnn9.8.0-windows-x64.zip' (Join-Path $dir 'katago-cuda.zip')
dl 'https://github.com/lightvector/KataGo/releases/download/v1.18.1/katago-v1.18.1-opencl-windows-x64.zip' (Join-Path $dir 'katago-opencl.zip')
dl 'https://media.katagotraining.org/uploaded/networks/models/kata1/kata1-tf3-b11c768-s11001M-d5973M.bin.gz' (Join-Path $dir 'kata1-tf3-b11c768-s11001M-d5973M.bin.gz')
Write-Output 'ALL DONE'
