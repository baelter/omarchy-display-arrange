function clampBrightness(value) {
  var n = Number(value)
  if (!isFinite(n)) return 1
  return Math.max(1, Math.min(100, Math.round(n)))
}

function normalizeScale(scale) {
  var n = parseFloat(String(scale || ""))
  if (!isFinite(n)) return ""
  return String(Math.round(n * 100) / 100)
}

function gcd(a, b) {
  while (b) {
    var remainder = a % b
    a = b
    b = remainder
  }
  return a
}

function cleanScale(scale, width, height) {
  var requested = Number(scale)
  var modeWidth = Number(width)
  var modeHeight = Number(height)
  if (!isFinite(requested) || !isFinite(modeWidth) || !isFinite(modeHeight)
      || requested <= 0 || modeWidth <= 0 || modeHeight <= 0) return ""

  var divisor = gcd(Math.round(modeWidth * 120), Math.round(modeHeight * 120))
  var scaleUnits = Math.round(requested * 120)
  if (scaleUnits > divisor) scaleUnits = divisor
  while (divisor % scaleUnits !== 0) scaleUnits++
  return normalizeScale(scaleUnits / 120)
}

function matchingScaleIndex(scales, currentScale, width, height) {
  var current = Number(currentScale)
  if (!Array.isArray(scales) || !isFinite(current)) return -1

  var bestIndex = -1
  var bestDistance = Infinity
  var normalizedCurrent = normalizeScale(current)
  for (var i = 0; i < scales.length; i++) {
    if (cleanScale(scales[i], width, height) !== normalizedCurrent) continue

    var distance = Math.abs(Number(scales[i]) - current)
    if (distance < bestDistance) {
      bestIndex = i
      bestDistance = distance
    }
  }
  return bestIndex
}

function availableScales(scales, width, height) {
  if (!Array.isArray(scales) || Number(width) <= 0 || Number(height) <= 0) return scales || []

  var byEffectiveScale = {}
  for (var i = 0; i < scales.length; i++) {
    var requested = Number(scales[i])
    var effective = Number(cleanScale(requested, width, height))

    if (!isFinite(requested) || !isFinite(effective)) continue

    var key = normalizeScale(effective)
    var existing = byEffectiveScale[key]
    if (!existing || Math.abs(requested - effective) < existing.distance) {
      byEffectiveScale[key] = {
        value: String(scales[i]),
        index: i,
        distance: Math.abs(requested - effective)
      }
    }
  }

  return Object.keys(byEffectiveScale)
    .map(function(key) { return byEffectiveScale[key] })
    .sort(function(a, b) { return a.index - b.index })
    .map(function(candidate) { return candidate.value })
}

function brightnessName(percent) {
  var p = Math.round(percent)
  if (p >= 95) return "Sun blast"
  if (p >= 80) return "Solar flare"
  if (p >= 65) return "Golden hour"
  if (p >= 45) return "Even day"
  if (p >= 30) return "Soft glow"
  if (p >= 20) return "Lamp light"
  if (p >= 10) return "Candlelit"
  return "Night owl"
}

function parseDisplays(raw) {
  var displays = []
  try {
    displays = raw ? JSON.parse(String(raw)) : []
  } catch (e) {
    displays = []
  }
  if (!Array.isArray(displays)) displays = []

  var count = 0
  for (var i = 0; i < displays.length; i++) {
    if (displays[i] && displays[i].enabled) count++
  }

  return {
    displays: displays,
    enabledDisplayCount: count
  }
}

function logicalSize(display) {
  var scale = Number(display && display.scale) || 1
  var w = Number(display.width) / scale
  var h = Number(display.height) / scale
  // hyprctl monitors -j reports the untransformed mode dimensions.
  // Hyprland swaps width/height for odd transforms (1=90°, 3=270°, and
  // the flipped-rotated variants 5, 7). Match that so the adjacency
  // guarantee holds for portrait/rotated displays.
  var transform = Number(display && display.transform) || 0
  if (transform % 2 === 1) return { width: h, height: w }
  return { width: w, height: h }
}

// Bounding box (in logical/layout coordinates) covering every enabled display.
function computeLayoutBounds(displays) {
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (var i = 0; i < displays.length; i++) {
    var d = displays[i]
    if (!d || !d.enabled) continue
    var size = logicalSize(d)
    if (d.x < minX) minX = d.x
    if (d.y < minY) minY = d.y
    if (d.x + size.width > maxX) maxX = d.x + size.width
    if (d.y + size.height > maxY) maxY = d.y + size.height
  }
  if (minX === Infinity) return { minX: 0, minY: 0, width: 0, height: 0 }
  return { minX: minX, minY: minY, width: maxX - minX, height: maxY - minY }
}

// Worst-case space needed to arrange every enabled display in a single row
// or a single column: sum of widths, sum of heights. The current (tighter)
// layout bounds only cover the arrangement as it stands, which leaves no
// room to drag into e.g. a vertical stack — sizing the canvas off this
// instead guarantees any single-axis rearrangement fits.
function computeLayoutCapacity(displays) {
  var width = 0, height = 0
  for (var i = 0; i < displays.length; i++) {
    var d = displays[i]
    if (!d || !d.enabled) continue
    var size = logicalSize(d)
    width += size.width
    height += size.height
  }
  return { width: width, height: height }
}

// Snaps a dropped position to align/touch edges with other enabled displays,
// independently per axis, within `threshold` logical pixels. Falls back to
// the raw (rounded) position when nothing is close enough.
function snapPosition(name, rawX, rawY, displays, threshold) {
  var self = null
  for (var i = 0; i < displays.length; i++) {
    if (displays[i] && displays[i].name === name) { self = displays[i]; break }
  }
  if (!self) return { x: Math.round(rawX), y: Math.round(rawY) }
  var selfSize = logicalSize(self)

  var candidatesX = []
  var candidatesY = []
  for (var j = 0; j < displays.length; j++) {
    var other = displays[j]
    if (!other || !other.enabled || other.name === name) continue
    var otherSize = logicalSize(other)
    candidatesX.push(other.x)
    candidatesX.push(other.x + otherSize.width - selfSize.width)
    candidatesX.push(other.x + otherSize.width)
    candidatesX.push(other.x - selfSize.width)
    candidatesY.push(other.y)
    candidatesY.push(other.y + otherSize.height - selfSize.height)
    candidatesY.push(other.y + otherSize.height)
    candidatesY.push(other.y - selfSize.height)
  }

  function nearest(value, candidates) {
    var best = value
    var bestDist = Infinity
    var found = false
    for (var k = 0; k < candidates.length; k++) {
      var dist = Math.abs(candidates[k] - value)
      // Inclusive threshold (a candidate exactly `threshold` away still
      // snaps), first-match wins so ties are deterministic.
      if (dist > threshold) continue
      if (!found || dist < bestDist) { bestDist = dist; best = candidates[k]; found = true }
    }
    return Math.round(best)
  }

  return { x: nearest(rawX, candidatesX), y: nearest(rawY, candidatesY) }
}

// After threshold-based snapping, if the dragged display still doesn't touch
// any other enabled display along a shared edge, snap unconditionally to the
// nearest edge candidate whose perpendicular projection overlaps ours. Keeps
// the layout adjacent — Hyprland's directional monitor lookup uses a 2px
// STICKS test, so a sloppy drop that lands outside snap threshold otherwise
// silently breaks `movecurrentworkspacetomonitor l/r/u/d`.
function enforceAdjacency(name, x, y, displays) {
  var self = null
  for (var i = 0; i < displays.length; i++) {
    if (displays[i] && displays[i].name === name) { self = displays[i]; break }
  }
  if (!self) return { x: Math.round(x), y: Math.round(y) }
  var selfSize = logicalSize(self)

  var others = []
  for (var i = 0; i < displays.length; i++) {
    var o = displays[i]
    if (!o || !o.enabled || o.name === name) continue
    others.push({ d: o, s: logicalSize(o) })
  }
  if (others.length === 0) return { x: Math.round(x), y: Math.round(y) }

  for (var i = 0; i < others.length; i++) {
    var od = others[i].d, os = others[i].s
    var xTouchRight = Math.abs((x + selfSize.width) - od.x) < 1
    var xTouchLeft = Math.abs(x - (od.x + os.width)) < 1
    var yOverlap = (y < od.y + os.height) && (y + selfSize.height > od.y)
    if ((xTouchRight || xTouchLeft) && yOverlap) return { x: Math.round(x), y: Math.round(y) }
    var yTouchBottom = Math.abs((y + selfSize.height) - od.y) < 1
    var yTouchTop = Math.abs(y - (od.y + os.height)) < 1
    var xOverlap = (x < od.x + os.width) && (x + selfSize.width > od.x)
    if ((yTouchBottom || yTouchTop) && xOverlap) return { x: Math.round(x), y: Math.round(y) }
  }

  var best = null
  var bestDist = Infinity
  for (var i = 0; i < others.length; i++) {
    var od = others[i].d, os = others[i].s
    // Clamp the perpendicular coordinate into the range where the pair's
    // projections overlap. A diagonally separated drop otherwise keeps the
    // raw perp coord, so nothing overlaps and adjacency silently drops.
    var yMin = od.y - selfSize.height + 1
    var yMax = od.y + os.height - 1
    var yClamped = Math.max(yMin, Math.min(yMax, y))
    var xMin = od.x - selfSize.width + 1
    var xMax = od.x + os.width - 1
    var xClamped = Math.max(xMin, Math.min(xMax, x))
    var candidates = [
      { x: od.x + os.width, y: yClamped },
      { x: od.x - selfSize.width, y: yClamped },
      { x: xClamped, y: od.y + os.height },
      { x: xClamped, y: od.y - selfSize.height }
    ]
    for (var c = 0; c < candidates.length; c++) {
      var cand = candidates[c]
      var d = Math.abs(cand.x - x) + Math.abs(cand.y - y)
      if (d < bestDist) { bestDist = d; best = cand }
    }
  }
  // Every enumerated candidate has clamped-overlap perpendicular coords, so
  // `best` is set whenever `others` was non-empty; the early return above
  // handles the empty case. This return is therefore always the snapped
  // point, never the raw input.
  return { x: Math.round(best.x), y: Math.round(best.y) }
}

// Substitute `override` (if given) for its named display, then translate the
// whole layout so the top-left of the bounding box is at (0, 0). Prevents the
// cumulative drift where each drop snapped against the previous drift.
function anchorLayout(displays, override) {
  var effective = []
  for (var i = 0; i < displays.length; i++) {
    var d = displays[i]
    if (!d) { effective.push(d); continue }
    if (override && d.name === override.name) {
      var copy = {}
      for (var k in d) copy[k] = d[k]
      copy.x = override.x
      copy.y = override.y
      effective.push(copy)
    } else {
      effective.push(d)
    }
  }
  var bounds = computeLayoutBounds(effective)
  if (!isFinite(bounds.minX) || !isFinite(bounds.minY)) return effective
  if (bounds.minX === 0 && bounds.minY === 0) return effective

  var anchored = []
  for (var i = 0; i < effective.length; i++) {
    var d = effective[i]
    if (!d || !d.enabled) { anchored.push(d); continue }
    var copy = {}
    for (var k in d) copy[k] = d[k]
    copy.x = Math.round(d.x - bounds.minX)
    copy.y = Math.round(d.y - bounds.minY)
    anchored.push(copy)
  }
  return anchored
}

function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by
}

// Hyprland refuses an overlapping layout outright, so a sloppy drop must
// never reach hyprctl/monitors.lua as-is. Nudges the dropped position by the
// smallest push (in whichever of the 4 directions is cheapest) until it no
// longer overlaps any other enabled display, re-checking each pass since
// resolving one collision can create another.
function resolveOverlap(name, x, y, displays) {
  var self = null
  for (var i = 0; i < displays.length; i++) {
    if (displays[i] && displays[i].name === name) { self = displays[i]; break }
  }
  if (!self) return { x: Math.round(x), y: Math.round(y) }
  var selfSize = logicalSize(self)
  var curX = x, curY = y

  for (var pass = 0; pass < 6; pass++) {
    var collided = null
    for (var j = 0; j < displays.length; j++) {
      var other = displays[j]
      if (!other || !other.enabled || other.name === name) continue
      var otherSize = logicalSize(other)
      if (rectsOverlap(curX, curY, selfSize.width, selfSize.height,
                        other.x, other.y, otherSize.width, otherSize.height)) {
        collided = { other: other, size: otherSize }
        break
      }
    }
    if (!collided) break

    var other = collided.other
    var otherSize = collided.size
    var candidates = [
      { dx: (other.x + otherSize.width) - curX, dy: 0 },
      { dx: (other.x - selfSize.width) - curX, dy: 0 },
      { dx: 0, dy: (other.y + otherSize.height) - curY },
      { dx: 0, dy: (other.y - selfSize.height) - curY }
    ]
    var best = candidates[0]
    for (var k = 1; k < candidates.length; k++) {
      if (Math.abs(candidates[k].dx) + Math.abs(candidates[k].dy) <
          Math.abs(best.dx) + Math.abs(best.dy)) best = candidates[k]
    }
    curX += best.dx
    curY += best.dy
  }

  return { x: Math.round(curX), y: Math.round(curY) }
}

if (typeof module !== "undefined") {
  module.exports = {
    clampBrightness: clampBrightness,
    normalizeScale: normalizeScale,
    cleanScale: cleanScale,
    matchingScaleIndex: matchingScaleIndex,
    availableScales: availableScales,
    brightnessName: brightnessName,
    parseDisplays: parseDisplays,
    logicalSize: logicalSize,
    computeLayoutBounds: computeLayoutBounds,
    computeLayoutCapacity: computeLayoutCapacity,
    snapPosition: snapPosition,
    resolveOverlap: resolveOverlap,
    enforceAdjacency: enforceAdjacency,
    anchorLayout: anchorLayout
  }
}
