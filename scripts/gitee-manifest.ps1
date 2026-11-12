param(
  [string]$Repo = "nekoosuu/after-school-updates",
  [string]$Path = "update.json",
  [string]$Message = "update manifest"
)
$ErrorActionPreference = "Stop"
$token = (Get-Content "E:\after-school\.gitee-token.txt" -Raw).Trim()
$sha = ""
try {
  $g = [System.Net.HttpWebRequest]::Create("https://gitee.com/api/v5/repos/$Repo/contents/$Path" + "?access_token=$token")
  $g.UserAgent = "after-school"
  $gr = $g.GetResponse()
  $gt = (New-Object IO.StreamReader($gr.GetResponseStream(), [Text.Encoding]::UTF8)).ReadToEnd()
  $sha = ($gt | ConvertFrom-Json).sha
  Write-Output "sha = $sha"
} catch {
  Write-Output "no existing file, will create"
  $sha = ""
}

$json = [System.IO.File]::ReadAllText("E:\after-school\update.json", [System.Text.UTF8Encoding]::new($false))
# 先自检 JSON 合法
$null = $json | ConvertFrom-Json
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))

$fields = @{ access_token = $token; content = $b64; message = $Message; branch = "master" }
if ($sha -ne "") { $fields["sha"] = $sha }
$body = $fields | ConvertTo-Json -Compress
$payload = [Text.Encoding]::UTF8.GetBytes($body)
$method = if ($sha -ne "") { "PUT" } else { "POST" }
$req = [System.Net.HttpWebRequest]::Create("https://gitee.com/api/v5/repos/$Repo/contents/$Path")
$req.Method = $method
$req.ContentType = "application/json; charset=utf-8"
$req.UserAgent = "after-school"
$req.ContentLength = $payload.Length
$s = $req.GetRequestStream(); $s.Write($payload, 0, $payload.Length); $s.Close()
$resp = $req.GetResponse()
$txt = (New-Object IO.StreamReader($resp.GetResponseStream(), [Text.Encoding]::UTF8)).ReadToEnd()
$j = $txt | ConvertFrom-Json
Write-Output ("OK " + $method + " sha=" + $j.content.sha)
Write-Output ("raw = " + $j.content.download_url)
