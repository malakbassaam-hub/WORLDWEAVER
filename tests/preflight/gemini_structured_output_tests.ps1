<#
.SYNOPSIS
    WORLDWEAVER - Gemini Structured-Output Reliability Test Suite
    Location : tests/preflight/gemini_structured_output_tests.ps1

.DESCRIPTION
    9 test cases exercising the Gemini structured-output API against the
    WORLDWEAVER world schema:
        worldName  : non-empty string
        biome      : non-empty string
        objects    : array of { name: non-empty string, type: non-empty string }

    Rules:
        - Exactly 9 API calls maximum; budget is enforced in code.
        - At least 5 seconds between consecutive API calls.
        - API key read exclusively from $env:GEMINI_API_KEY at runtime.
        - Key is NEVER printed, logged, or stored anywhere.
        - No third-party modules; only PowerShell built-ins (5.1+).
        - No automatic retries.
        - Missing key: all tests BLOCKED instantly, no delays.

.NOTES
    Static syntax check and no-key dry-run produce no API calls.

    To run when GEMINI_API_KEY is already set in your session:
        .\tests\preflight\gemini_structured_output_tests.ps1
#>

#Requires -Version 5.1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
$GEMINI_MODEL   = 'gemini-3.5-flash-lite'
$API_BASE       = 'https://generativelanguage.googleapis.com/v1beta/models'
$CALL_DELAY_SEC = 5
$TIMEOUT_SEC    = 30
$MAX_API_CALLS  = 9

# ---------------------------------------------------------------------------
# World schema for responseSchema (structured output)
# ---------------------------------------------------------------------------
$WORLD_SCHEMA = @{
    type       = 'object'
    properties = @{
        worldName = @{ type = 'string' }
        biome     = @{ type = 'string' }
        objects   = @{
            type  = 'array'
            items = @{
                type       = 'object'
                properties = @{
                    name = @{ type = 'string' }
                    type = @{ type = 'string' }
                }
                required   = @('name','type')
            }
        }
    }
    required   = @('worldName','biome','objects')
}

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------
[int]   $script:apiCallsMade = 0
$script:results = [System.Collections.Generic.List[PSCustomObject]]::new()

# ---------------------------------------------------------------------------
# Test-ApiKeyPresent
#   Returns $true only when GEMINI_API_KEY is set and non-blank.
#   Never exposes the key value.
# ---------------------------------------------------------------------------
function Test-ApiKeyPresent {
    $k = $env:GEMINI_API_KEY
    return ($null -ne $k -and $k.Trim().Length -gt 0)
}

# ---------------------------------------------------------------------------
# Invoke-GeminiStructured
#   Sends a single structured-output request to Gemini.
#   Body is UTF-8 encoded explicitly for PS 5.1 compatibility.
#   Returns @{ Success=bool; Data=PSObject|$null; ErrorMsg=string; HttpStatus=int|$null }
# ---------------------------------------------------------------------------
function Invoke-GeminiStructured {
    param(
        [string]   $Prompt,
        [hashtable]$Schema
    )

    if ($script:apiCallsMade -ge $script:MAX_API_CALLS) {
        return @{
            Success    = $false
            Data       = $null
            ErrorMsg   = "API call budget ($($script:MAX_API_CALLS)) exhausted."
            HttpStatus = $null
        }
    }

    # Build URI - key is never stored in a variable that outlives this scope
    $uri = "$($script:API_BASE)/$($script:GEMINI_MODEL):generateContent?key=$($env:GEMINI_API_KEY)"

    # Serialise body, then encode to UTF-8 bytes so non-ASCII prompts are correct
    $bodyJson  = @{
        contents         = @(
            @{ parts = @( @{ text = $Prompt } ) }
        )
        generationConfig = @{
            responseMimeType = 'application/json'
            responseSchema   = $Schema
        }
    } | ConvertTo-Json -Depth 20 -Compress
    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($bodyJson)

    $script:apiCallsMade++

    try {
        $response = Invoke-RestMethod `
            -Uri         $uri `
            -Method      Post `
            -Headers     @{ 'Content-Type' = 'application/json; charset=utf-8' } `
            -Body        $bodyBytes `
            -TimeoutSec  $script:TIMEOUT_SEC `
            -ErrorAction Stop

        # Navigate candidate text
        $candidate = $response.candidates
        if ($null -eq $candidate -or $candidate.Count -eq 0) {
            return @{ Success = $false; Data = $null; ErrorMsg = 'No candidates in response.'; HttpStatus = 200 }
        }
        $rawText = $candidate[0].content.parts[0].text
        if ([string]::IsNullOrWhiteSpace($rawText)) {
            return @{ Success = $false; Data = $null; ErrorMsg = 'Candidate text is empty.'; HttpStatus = 200 }
        }

        # Parse JSON - catch malformed output
        try {
            $parsed = $rawText | ConvertFrom-Json -ErrorAction Stop
        }
        catch {
            return @{ Success = $false; Data = $null; ErrorMsg = "JSON parse failed: $($_.Exception.Message)"; HttpStatus = 200 }
        }

        return @{ Success = $true; Data = $parsed; ErrorMsg = ''; HttpStatus = 200 }
    }
    catch [System.Net.WebException] {
        $httpStatus = $null
        if ($null -ne $_.Exception.Response) {
            $httpStatus = [int]$_.Exception.Response.StatusCode
        }
        $errMsg = $_.Exception.Message
        if ($httpStatus -eq 429) {
            $msg = "HTTP 429 Rate-Limited - $errMsg"
        } elseif ($null -ne $httpStatus) {
            $msg = "HTTP $($httpStatus) - $errMsg"
        } else {
            $msg = "Network error - $errMsg"
        }
        return @{ Success = $false; Data = $null; ErrorMsg = $msg; HttpStatus = $httpStatus }
    }
    catch [System.OperationCanceledException] {
        return @{ Success = $false; Data = $null; ErrorMsg = "Request timed out after ${script:TIMEOUT_SEC}s."; HttpStatus = $null }
    }
    catch {
        $t = $_.Exception.GetType().Name
        return @{ Success = $false; Data = $null; ErrorMsg = "${t}: $($_.Exception.Message)"; HttpStatus = $null }
    }
}

# ---------------------------------------------------------------------------
# Assert-WorldSchema
#   Validates required fields, types, and non-empty strings.
#   Returns '' on success; semicolon-joined errors on failure.
# ---------------------------------------------------------------------------
function Assert-WorldSchema {
    param($Obj)

    $errs = [System.Collections.Generic.List[string]]::new()

    # worldName
    if ($null -eq $Obj.worldName) {
        $errs.Add('worldName is missing')
    } elseif ($Obj.worldName -isnot [string]) {
        $errs.Add('worldName is not a string')
    } elseif ($Obj.worldName.Trim().Length -eq 0) {
        $errs.Add('worldName is blank')
    }

    # biome
    if ($null -eq $Obj.biome) {
        $errs.Add('biome is missing')
    } elseif ($Obj.biome -isnot [string]) {
        $errs.Add('biome is not a string')
    } elseif ($Obj.biome.Trim().Length -eq 0) {
        $errs.Add('biome is blank')
    }

    # objects array
    if ($null -eq $Obj.objects) {
        $errs.Add('objects is missing')
    } elseif ($Obj.objects -isnot [System.Object[]]) {
        # ConvertFrom-Json returns Object[] for arrays; a single item becomes PSCustomObject
        # Treat a single PSCustomObject as a 1-element array for item validation
        $itemsToCheck = if ($Obj.objects -is [System.Management.Automation.PSCustomObject]) {
            @($Obj.objects)
        } else {
            $errs.Add('objects is not an array')
            @()
        }
        foreach ($item in $itemsToCheck) {
            if ($null -eq $item.name -or $item.name -isnot [string] -or $item.name.Trim().Length -eq 0) {
                $errs.Add("objects[?].name is missing, non-string, or blank"); break
            }
            if ($null -eq $item.type -or $item.type -isnot [string] -or $item.type.Trim().Length -eq 0) {
                $errs.Add("objects[?].type is missing, non-string, or blank"); break
            }
        }
    } else {
        $i = 0
        foreach ($item in $Obj.objects) {
            if ($null -eq $item.name -or $item.name -isnot [string] -or $item.name.Trim().Length -eq 0) {
                $errs.Add("objects[$i].name is missing, non-string, or blank"); break
            }
            if ($null -eq $item.type -or $item.type -isnot [string] -or $item.type.Trim().Length -eq 0) {
                $errs.Add("objects[$i].type is missing, non-string, or blank"); break
            }
            $i++
        }
    }

    return ($errs -join '; ')
}

# ---------------------------------------------------------------------------
# Get-ObjectCount
#   Safe .Count that works under Set-StrictMode for both arrays and
#   single PSCustomObjects returned by ConvertFrom-Json.
# ---------------------------------------------------------------------------
function Get-ObjectCount {
    param($Obj)
    if ($null -eq $Obj.objects) { return 0 }
    if ($Obj.objects -is [System.Object[]]) { return $Obj.objects.Count }
    # Single-item array deserialised as PSCustomObject
    if ($Obj.objects -is [System.Management.Automation.PSCustomObject]) { return 1 }
    return 0
}

# ---------------------------------------------------------------------------
# Write-Result
#   Records and displays a single test-case result.
# ---------------------------------------------------------------------------
function Write-Result {
    param(
        [int]   $Index,
        [string]$Name,
        [string]$Status,
        [string]$Detail = ''
    )

    $icon   = switch ($Status) { 'PASS' { '[PASS]   ' } 'FAIL' { '[FAIL]   ' } 'BLOCKED' { '[BLOCKED]' } default { '[?]      ' } }
    $colour = switch ($Status) { 'PASS' { 'Green'   } 'FAIL' { 'Red'     } 'BLOCKED' { 'Yellow'   } default { 'White'   } }

    Write-Host "$icon TC-$Index  $Name" -ForegroundColor $colour
    if ($Detail) { Write-Host "          $Detail" -ForegroundColor DarkGray }

    $script:results.Add([PSCustomObject]@{
        TC     = $Index
        Name   = $Name
        Status = $Status
        Detail = $Detail
    })
}

# ---------------------------------------------------------------------------
# Invoke-Throttle
#   Waits CALL_DELAY_SEC seconds between API calls.
#   Skipped entirely when no API key is present.
# ---------------------------------------------------------------------------
function Invoke-Throttle {
    if (-not (Test-ApiKeyPresent)) { return }
    Write-Host "          [throttle ${script:CALL_DELAY_SEC}s ...]" -ForegroundColor DarkGray
    Start-Sleep -Seconds $script:CALL_DELAY_SEC
}

# ===========================================================================
# HEADER
# ===========================================================================

Write-Host ''
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host '  WORLDWEAVER - Gemini Structured-Output Test Suite'          -ForegroundColor Cyan
Write-Host "  Model        : $GEMINI_MODEL"
Write-Host "  Max API calls: $MAX_API_CALLS"
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host ''

$keyPresent = Test-ApiKeyPresent

if (-not $keyPresent) {
    Write-Host '[WARNING] GEMINI_API_KEY is not set. All tests will be BLOCKED instantly.' -ForegroundColor Yellow
    Write-Host ''
}

# ===========================================================================
# TC-1  Baseline - complex world, 5 named objects
# ===========================================================================
$tcName = 'Baseline: complex world, 5 named objects'
if (-not $keyPresent) {
    Write-Result 1 $tcName 'BLOCKED' 'API key unavailable'
} else {
    $r = Invoke-GeminiStructured -Schema $WORLD_SCHEMA -Prompt @'
Generate a detailed fantasy world called "Aethermoor".
Biome: floating island archipelago.
Include EXACTLY 5 objects: a crystal tower, a lava vent, an ancient door, a fog lake, and a bone bridge.
'@
    if (-not $r.Success) {
        Write-Result 1 $tcName 'FAIL' $r.ErrorMsg
    } else {
        $se = Assert-WorldSchema $r.Data
        if ($se) {
            Write-Result 1 $tcName 'FAIL' $se
        } else {
            $cnt = Get-ObjectCount $r.Data
            if ($cnt -ne 5) {
                Write-Result 1 $tcName 'FAIL' "Expected 5 objects, got $cnt"
            } else {
                Write-Result 1 $tcName 'PASS' "worldName=$($r.Data.worldName)  biome=$($r.Data.biome)  objects=$cnt"
            }
        }
    }
}

# ===========================================================================
# TC-2  Arabic-language prompt (genuine Arabic script, UTF-8)
# ===========================================================================
Invoke-Throttle
$tcName = 'Arabic-language prompt'
if (-not $keyPresent) {
    Write-Result 2 $tcName 'BLOCKED' 'API key unavailable'
} else {
    # Prompt is entirely in Arabic Unicode. Body is UTF-8 encoded by Invoke-GeminiStructured.
    $arabicPrompt = @'
قم بإنشاء عالم خيالي باسم "الظلام الأبيض".
نوع التضاريس: صحراء جليدية.
أضف بالضبط 3 كائنات: برج الملح، بحيرة الرماد، بوابة الريح.
اكتب جميع قيم الحقول باللغة العربية.
'@
    $r = Invoke-GeminiStructured -Schema $WORLD_SCHEMA -Prompt $arabicPrompt
    if (-not $r.Success) {
        Write-Result 2 $tcName 'FAIL' $r.ErrorMsg
    } else {
        $se = Assert-WorldSchema $r.Data
        if ($se) {
            Write-Result 2 $tcName 'FAIL' $se
        } else {
            $cnt = Get-ObjectCount $r.Data
            if ($cnt -ne 3) {
                Write-Result 2 $tcName 'FAIL' "Expected 3 objects, got $cnt"
            } else {
                Write-Result 2 $tcName 'PASS' "worldName=$($r.Data.worldName)  biome=$($r.Data.biome)  objects=$cnt"
            }
        }
    }
}

# ===========================================================================
# TC-3  Mixed Arabic/English prompt (genuine bilingual, UTF-8)
# ===========================================================================
Invoke-Throttle
$tcName = 'Mixed Arabic/English prompt'
if (-not $keyPresent) {
    Write-Result 3 $tcName 'BLOCKED' 'API key unavailable'
} else {
    $mixedPrompt = @'
Create a world called "Neon Oasis" (واحة النيون).
Biome: cyber-desert (صحراء إلكترونية).
Add EXACTLY 4 objects: holographic palm tree, data-stream river, neon dune, signal tower.
Write all field values in English.
'@
    $r = Invoke-GeminiStructured -Schema $WORLD_SCHEMA -Prompt $mixedPrompt
    if (-not $r.Success) {
        Write-Result 3 $tcName 'FAIL' $r.ErrorMsg
    } else {
        $se = Assert-WorldSchema $r.Data
        if ($se) {
            Write-Result 3 $tcName 'FAIL' $se
        } else {
            $cnt = Get-ObjectCount $r.Data
            if ($cnt -ne 4) {
                Write-Result 3 $tcName 'FAIL' "Expected 4 objects, got $cnt"
            } else {
                Write-Result 3 $tcName 'PASS' "worldName=$($r.Data.worldName)  biome=$($r.Data.biome)  objects=$cnt"
            }
        }
    }
}

# ===========================================================================
# TC-4  Exact object count enforced: 3 objects
# ===========================================================================
Invoke-Throttle
$tcName = 'Exact object count: 3 objects'
if (-not $keyPresent) {
    Write-Result 4 $tcName 'BLOCKED' 'API key unavailable'
} else {
    $r = Invoke-GeminiStructured -Schema $WORLD_SCHEMA -Prompt @'
Generate a world called "Tristone". Biome: rocky wasteland.
Include EXACTLY 3 objects: a black monolith, a cracked well, a stone altar.
No more objects and no fewer objects than 3.
'@
    if (-not $r.Success) {
        Write-Result 4 $tcName 'FAIL' $r.ErrorMsg
    } else {
        $se = Assert-WorldSchema $r.Data
        if ($se) {
            Write-Result 4 $tcName 'FAIL' $se
        } else {
            $cnt = Get-ObjectCount $r.Data
            if ($cnt -ne 3) {
                Write-Result 4 $tcName 'FAIL' "Expected exactly 3 objects, got $cnt"
            } else {
                Write-Result 4 $tcName 'PASS' "worldName=$($r.Data.worldName)  biome=$($r.Data.biome)  objects=$cnt"
            }
        }
    }
}

# ===========================================================================
# TC-5  Empty/barren scene: schema valid even with 0 objects
# ===========================================================================
Invoke-Throttle
$tcName = 'Empty/barren scene: schema valid with 0 objects'
if (-not $keyPresent) {
    Write-Result 5 $tcName 'BLOCKED' 'API key unavailable'
} else {
    $r = Invoke-GeminiStructured -Schema $WORLD_SCHEMA -Prompt @'
Generate a world called "Void Plain". Biome: empty void.
The world is completely featureless - there are NO objects at all. Return an empty objects array.
'@
    if (-not $r.Success) {
        Write-Result 5 $tcName 'FAIL' $r.ErrorMsg
    } else {
        $se = Assert-WorldSchema $r.Data
        if ($se) {
            Write-Result 5 $tcName 'FAIL' $se
        } else {
            $cnt = Get-ObjectCount $r.Data
            # Pass condition: schema is valid; zero is acceptable, non-zero is noted but still passes
            Write-Result 5 $tcName 'PASS' "worldName=$($r.Data.worldName)  biome=$($r.Data.biome)  objects=$cnt (requested 0)"
        }
    }
}

# ===========================================================================
# TC-6  Conflicting instructions: schema must still be valid
# ===========================================================================
Invoke-Throttle
$tcName = 'Conflicting instructions: schema survives contradiction'
if (-not $keyPresent) {
    Write-Result 6 $tcName 'BLOCKED' 'API key unavailable'
} else {
    $r = Invoke-GeminiStructured -Schema $WORLD_SCHEMA -Prompt @'
Generate a world called "Paradox".
The biome is simultaneously a frozen tundra AND a tropical rainforest.
Objects must include both icebergs and palm trees.
Temperature is both -40C and +40C at the same time.
Resolve any contradiction however you like, but return valid JSON.
'@
    if (-not $r.Success) {
        Write-Result 6 $tcName 'FAIL' $r.ErrorMsg
    } else {
        $se = Assert-WorldSchema $r.Data
        if ($se) {
            Write-Result 6 $tcName 'FAIL' $se
        } else {
            $cnt = Get-ObjectCount $r.Data
            if ($cnt -lt 1) {
                Write-Result 6 $tcName 'FAIL' 'Expected at least 1 object, got 0'
            } else {
                Write-Result 6 $tcName 'PASS' "worldName=$($r.Data.worldName)  biome=$($r.Data.biome)  objects=$cnt"
            }
        }
    }
}

# ===========================================================================
# TC-7  Ambiguous request: minimal prompt, schema must still be satisfied
# ===========================================================================
Invoke-Throttle
$tcName = 'Ambiguous request: minimal prompt'
if (-not $keyPresent) {
    Write-Result 7 $tcName 'BLOCKED' 'API key unavailable'
} else {
    $r = Invoke-GeminiStructured -Schema $WORLD_SCHEMA -Prompt 'Make a world. It should be nice. Add some stuff.'
    if (-not $r.Success) {
        Write-Result 7 $tcName 'FAIL' $r.ErrorMsg
    } else {
        $se = Assert-WorldSchema $r.Data
        if ($se) {
            Write-Result 7 $tcName 'FAIL' $se
        } else {
            $cnt = Get-ObjectCount $r.Data
            if ($cnt -lt 1) {
                Write-Result 7 $tcName 'FAIL' 'Expected at least 1 object, got 0'
            } else {
                Write-Result 7 $tcName 'PASS' "worldName=$($r.Data.worldName)  biome=$($r.Data.biome)  objects=$cnt"
            }
        }
    }
}

# ===========================================================================
# TC-8  Special characters: symbols in world name and object names
# ===========================================================================
Invoke-Throttle
$tcName = 'Special characters in names'
if (-not $keyPresent) {
    Write-Result 8 $tcName 'BLOCKED' 'API key unavailable'
} else {
    $r = Invoke-GeminiStructured -Schema $WORLD_SCHEMA -Prompt @'
Generate a world. Name it exactly: Zon-3/Alpha#2 (Glitch).
Biome: glitch dimension.
Include EXACTLY 2 objects whose names contain punctuation or numbers, e.g. "Gate//7" and "Node_0x1F".
'@
    if (-not $r.Success) {
        Write-Result 8 $tcName 'FAIL' $r.ErrorMsg
    } else {
        $se = Assert-WorldSchema $r.Data
        if ($se) {
            Write-Result 8 $tcName 'FAIL' $se
        } else {
            $cnt = Get-ObjectCount $r.Data
            if ($cnt -ne 2) {
                Write-Result 8 $tcName 'FAIL' "Expected exactly 2 objects, got $cnt"
            } else {
                Write-Result 8 $tcName 'PASS' "worldName=$($r.Data.worldName)  objects=$cnt"
            }
        }
    }
}

# ===========================================================================
# TC-9  Large object list: exactly 6 objects
# ===========================================================================
Invoke-Throttle
$tcName = 'Large object list: exactly 6 objects'
if (-not $keyPresent) {
    Write-Result 9 $tcName 'BLOCKED' 'API key unavailable'
} else {
    $r = Invoke-GeminiStructured -Schema $WORLD_SCHEMA -Prompt @'
Generate a world called "Hexwood". Biome: enchanted forest.
Include EXACTLY 6 objects, each with a unique name and type:
ancient oak, mushroom ring, hidden shrine, talking brook, fox den, moon arch.
'@
    if (-not $r.Success) {
        Write-Result 9 $tcName 'FAIL' $r.ErrorMsg
    } else {
        $se = Assert-WorldSchema $r.Data
        if ($se) {
            Write-Result 9 $tcName 'FAIL' $se
        } else {
            $cnt = Get-ObjectCount $r.Data
            if ($cnt -ne 6) {
                Write-Result 9 $tcName 'FAIL' "Expected exactly 6 objects, got $cnt"
            } else {
                Write-Result 9 $tcName 'PASS' "worldName=$($r.Data.worldName)  biome=$($r.Data.biome)  objects=$cnt"
            }
        }
    }
}

# ===========================================================================
# SUMMARY
# ===========================================================================

Write-Host ''
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host '  SUMMARY' -ForegroundColor Cyan
Write-Host '============================================================' -ForegroundColor Cyan

$pass    = @($script:results | Where-Object { $_.Status -eq 'PASS'    }).Count
$fail    = @($script:results | Where-Object { $_.Status -eq 'FAIL'    }).Count
$blocked = @($script:results | Where-Object { $_.Status -eq 'BLOCKED' }).Count
$total   = $script:results.Count

Write-Host "  Total     : $total"
Write-Host "  PASS      : $pass"    -ForegroundColor Green
Write-Host "  FAIL      : $fail"    -ForegroundColor $(if ($fail -gt 0) { 'Red' } else { 'Green' })
Write-Host "  BLOCKED   : $blocked" -ForegroundColor $(if ($blocked -gt 0) { 'Yellow' } else { 'Green' })
Write-Host "  API calls : $($script:apiCallsMade) / $MAX_API_CALLS"
Write-Host ''

if ($blocked -eq $total) {
    Write-Host '  All tests BLOCKED - GEMINI_API_KEY is not set.' -ForegroundColor Yellow
    Write-Host ''
    Write-Host '  To run from an existing session where the key is already set:' -ForegroundColor Yellow
    Write-Host '      .\tests\preflight\gemini_structured_output_tests.ps1' -ForegroundColor White
    Write-Host ''
} elseif ($fail -eq 0) {
    Write-Host '  All executed tests PASSED.' -ForegroundColor Green
} else {
    Write-Host '  One or more tests FAILED. See FAIL lines above.' -ForegroundColor Red
}

Write-Host '============================================================' -ForegroundColor Cyan
Write-Host ''
