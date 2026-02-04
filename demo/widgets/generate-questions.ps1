$ErrorActionPreference = "Stop"

function Read-NonEmpty($prompt) {
  while ($true) {
    $value = Read-Host $prompt
    if ($value -ne "") { return $value }
    Write-Host "Please enter a value."
  }
}

function Read-OptionLetter($prompt, $allowed) {
  while ($true) {
    $value = (Read-Host $prompt).Trim().ToUpper()
    if ($allowed -contains $value) { return $value }
    Write-Host ("Please enter one of: " + ($allowed -join ", "))
  }
}

function Read-OptionCount($prompt) {
  while ($true) {
    $value = (Read-Host $prompt).Trim()
    if ($value -match '^[234]$') { return [int]$value }
    Write-Host "Please enter 2, 3, or 4."
  }
}

function Read-PositiveInt($prompt, $default) {
  while ($true) {
    $value = Read-Host $prompt
    if ($value -eq "") { return $default }
    if ($value -match '^\d+$' -and [int]$value -gt 0) { return [int]$value }
    Write-Host "Please enter a positive number."
  }
}

$questions = @()

Write-Host "Enter questions for the Q&A widget."
Write-Host "Leave duration blank to use 15 seconds."

while ($true) {
  $q = Read-NonEmpty "Question"
  $optionCount = Read-OptionCount "How many options for the question? (2/3/4)"
  $options = @{}
  $allowed = @()
  if ($optionCount -ge 2) {
    $options["A"] = Read-NonEmpty "Option A"
    $options["B"] = Read-NonEmpty "Option B"
    $allowed += "A", "B"
  }
  if ($optionCount -ge 3) {
    $options["C"] = Read-NonEmpty "Option C"
    $allowed += "C"
  }
  if ($optionCount -ge 4) {
    $options["D"] = Read-NonEmpty "Option D"
    $allowed += "D"
  }
  $correct = Read-OptionLetter ("Correct option (" + ($allowed -join "/") + ")") $allowed
  $duration = Read-PositiveInt "Duration in seconds (default 15)" 15

  $questions += [pscustomobject]@{
    question = $q
    options  = $options
    correct  = $correct
    duration = $duration
  }

  $more = (Read-Host "Add another question? (y/n)").Trim().ToLower()
  if ($more -ne "y") { break }
}

$json = @($questions) | ConvertTo-Json -Depth 5
$outPath = Join-Path $PSScriptRoot "questions.json"
$json | Set-Content -Path $outPath -Encoding UTF8

Write-Host "Saved $($questions.Count) question(s) to $outPath"
