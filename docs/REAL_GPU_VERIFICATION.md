# Real-GPU Verification Procedure

Manual verification of WORLDWEAVER 3D rendering on real hardware (the owner's
Windows laptop). Automated CI runs use SwiftShader (software WebGL); this
procedure confirms behaviour on a hardware GPU.

**Status:** BLOCKED until the owner runs it on their Windows laptop. Do not
label SwiftShader results as real-GPU results.

## Prerequisites

- Windows laptop with a discrete or integrated GPU (not SwiftShader/software)
- Google Chrome installed
- Repository branch `feature/renderer-futures-1120` checked out at the
  delivered commit
- Node.js 24 installed
- `node_modules` linked (junction) and `npm run build` passing

## Step 0: Confirm hardware WebGL (not SwiftShader)

Open `chrome://gpu` in Chrome. Record:

| Field | Expected (real GPU) | Actual (your machine) |
|---|---|---|
| `Canvas` → `Hardware accelerated` | `true` | |
| `WebGL` → `Renderer` | GPU vendor name (e.g. NVIDIA, AMD, Intel) | |
| `WebGL` → `Vendor` | GPU vendor | |
| `Problems detected` | None related to WebGL | |

If `Renderer` reports `SwiftShader` or `Microsoft Basic Render Driver`, this is
**not** real-GPU verification. Stop.

Also confirm in DevTools Console → `gl.getParameter(gl.RENDERER)` returns a
hardware GPU name, not `SwiftShader`.

## Step 1: Build and start the studio

```powershell
Set-Location C:\Users\user\WORLDWEAVER-KILO-1120
git branch --show-current    # must print: feature/renderer-futures-1120
npm run build                # must PASS
npm run dev                  # starts Vite dev server on :5199
```

Open `http://127.0.0.1:5199/` in Chrome.

## Step 2: Baseline rendering

1. Confirm the Crystal Kingdom loads: 27 entities, canvas visible, no fallback.
2. Open DevTools Console: no real errors (benign SwiftShader-style shader
   warnings are fine on real GPU too, but they should not be `WebGL` errors).
3. Read the stats panel: FPS, draw calls, triangles, entities.
4. Take a screenshot: `baseline-crystal-kingdom.png`.

## Step 3: Camera movement

1. Orbit the camera (left-click drag).
2. Zoom (scroll wheel).
3. Pan (right-click drag).
4. Press `F` to frame the selected entity.
5. Press `Home` to reset camera.
6. Confirm smooth movement, no stutter, no loss of rendering.
7. Take a screenshot: `camera-movement.png`.

## Step 4: World Morph animation (if morph is enabled)

With `DIRECTOR_MORPH=1` on the server:

1. Open the AI World Director panel.
2. Click **Morph**.
3. Enter: `violet dusk`.
4. Click **Generate**.
5. Confirm the morph preview shows entity names (not raw IDs) in the pinned list.
6. Click **Apply**.
7. Confirm the transition animates changed entities over ≤1200 ms.
8. Confirm pinned entities (e.g. Aurelion Citadel) do not move during the transition.
9. Press `Ctrl+Z` to undo; confirm the world snaps back.
10. Press `Ctrl+Shift+Z` to redo; confirm the morph returns.
11. Take screenshots: `morph-preview.png`, `morph-applied.png`.

## Step 5: Performance comparison

1. Toggle quality: Cinematic → Performance → Cinematic.
2. Record stats panel numbers in each mode:
   - Cinematic: FPS, draw calls, triangles
   - Performance: FPS, draw calls, triangles
3. Confirm Performance mode has fewer draw calls (no bloom/shadows) and 1× DPR.
4. Take screenshots: `stats-cinematic.png`, `stats-performance.png`.

## Step 6: Reduced-motion

1. Enable Windows "Show animations" = off (or set
   `prefers-reduced-motion: reduce` via Chrome DevTools rendering emulation).
2. Refresh the page.
3. Apply a morph: confirm the change is instant (no animation).
4. Take a screenshot: `reduced-motion.png`.

## Step 7: WebGL context-loss recovery

1. Open DevTools Console.
2. Run: `canvas.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()`
3. Confirm the fallback appears: "The 3D context was lost".
4. Run: `canvas.getContext('webgl2').getExtension('WEBGL_lose_context').restoreContext()`
5. Confirm the viewport restores: canvas visible, fallback dismissed.
6. Confirm selection and edits survived (select an entity, rename it, lose/restore, verify name).
7. Take screenshots: `context-loss.png`, `context-restored.png`.

## Step 8: Evidence

Collect and attach:
- `chrome://gpu` screenshot
- `baseline-crystal-kingdom.png`
- `camera-movement.png`
- `morph-preview.png`, `morph-applied.png` (if morph tested)
- `stats-cinematic.png`, `stats-performance.png`
- `reduced-motion.png`
- `context-loss.png`, `context-restored.png`
- Console output (no real errors)

## Pass criteria

| Check | Pass condition |
|---|---|
| Hardware WebGL | `chrome://gpu` Renderer is a real GPU, not SwiftShader |
| Baseline render | 27 entities, canvas visible, no fallback |
| Camera movement | Smooth orbit/zoom/pan, no stutter |
| Morph transition | ≤1200 ms, pinned entities not animated |
| Performance mode | Fewer draw calls than cinematic |
| Reduced motion | Morph is instant |
| Context loss recovery | Viewport restores, selection/edits survive |
| No console errors | No real WebGL errors |

## If hardware access is unavailable

Mark this check **BLOCKED** and do not claim real-GPU results. Automated
SwiftShader results (36/36 e2e pass) are the best available evidence but are
not a substitute for real-GPU verification.
