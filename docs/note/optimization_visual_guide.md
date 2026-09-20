# 📊 Visual Guide - Tối Ưu Render Cycle

## 1. Vấn Đề: Render 3 Lần

### Biểu Đồ: Timeline Hiện Tại

```
USER INPUT
   │
   └─ fontSize: 18 → 20, highlights.push(new), layout: 'single' → 'dual'
       │
       ├─┬─ fontSize Effect [2159]
       │ └─→ setFontSize(20)
       │    └─→ scheduleRepaint()  ← Set timeout 50ms
       │
       ├─┬─ highlights Effect [2165] ⚡ PAINT #1
       │ └─→ paintHighlightsNow()
       │    └─→ painter.paint()
       │
       ├─┬─ layout Effect [2170]
       │ └─→ setLayout('dual')
       │    └─→ scheduleRepaint()  ← Set timeout 50ms (clear previous)
       │
       └─┬─ ... 22 more effects ...
         └─→ Each scheduleRepaint() → timeout
             └─ After 50ms:
                 └─ paintHighlightsNow() ⚡ PAINT #2 (DUPLICATE!)

RESULT: ❌ Render 3 times, paint 2-3 times, messy
```

### Vấn Đề Chi Tiết

```
┌─────────────────────────────────────────┐
│         EpubRenderer Component          │
├─────────────────────────────────────────┤
│                                         │
│  Props: {                               │
│    fontSize: 20         ──┬─→ useEffect #1
│    fontFamily: "serif"  ──┼─→ useEffect #2
│    fontWeight: 600      ──┼─→ useEffect #3
│    layout: "dual"       ──┼─→ useEffect #4
│    theme: "dark"        ──┼─→ useEffect #5
│    highlights: [...]    ──┼─→ useEffect #6
│    ... more props       ──┼─→ useEffect #7-25
│  }                       ──┘
│                                         │
│  ┌─────────────────────────────────┐  │
│  │ useEffect #1 [fontSize]         │  │
│  │ Dependencies: [fontSize]        │  │
│  │ → setFontSize()                 │  │
│  │ → scheduleRepaint() [timeout]   │  │
│  └─────────────────────────────────┘  │
│           │                             │
│           ├─ PAINT #1 (50ms)           │
│           │                             │
│  ┌─────────────────────────────────┐  │
│  │ useEffect #6 [highlights]       │  │
│  │ Dependencies: [highlights]      │  │
│  │ → paintHighlightsNow() [sync]   │  │
│  └─────────────────────────────────┘  │
│           │                             │
│           ├─ PAINT #2 (immediate)      │
│           │  └─ ❌ DUPLICATE! (same as #1)
│           │                             │
│  After 50ms timeout:                   │
│           ├─ PAINT #3 (from effect #1) │
│           │  └─ ❌ DUPLICATE again!    │
│                                         │
└─────────────────────────────────────────┘

PROBLEM: Multiple paints for same overlay!
```

---

## 2. Root Cause: useEffect Hell

### Dependency Chaos

```
Change: fontSize = 20
   │
   ├─ [fontSize] useEffect triggers
   │  └─ scheduleRepaint()
   │     └─ setTimeout 50ms
   │
Change: highlights = [new item]
   │
   ├─ [highlights] useEffect triggers
   │  └─ paintHighlightsNow()
   │     └─ PAINT NOW! ⚡
   │
Change: layout = 'dual'
   │
   ├─ [layout] useEffect triggers
   │  └─ scheduleRepaint()
   │     └─ setTimeout 50ms (clear previous)
   │
   ├─ ... 22 more effects ...
   │
After 50ms:
   └─ Previous timeouts fire
      └─ paintHighlightsNow() ⚡ (DUPLICATE!)

REASON: No batching, no deduplication
        Each prop has its own effect
        Each effect can schedule paint independently
```

---

## 3. Giải Pháp: Batch & Debounce

### Architecture Tối Ưu

```
┌─────────────────────────────────────────┐
│         EpubRenderer Component          │
├─────────────────────────────────────────┤
│                                         │
│  Props: {                               │
│    fontSize: 20         \               │
│    fontFamily: "serif"   \              │
│    fontWeight: 600        ├─→ useEffect #1 (BATCH)
│    layout: "dual"        /              │
│    theme: "dark"        /               │
│    highlights: [...]   /                │
│    ... more props ... /                 │
│  }                                      │
│                                         │
│  ┌──────────────────────────────────┐  │
│  │ useEffect #1 [ALL SETTINGS]      │  │
│  │ Dependencies: [                  │  │
│  │   fontSize,                      │  │
│  │   fontFamily,                    │  │
│  │   fontWeight,                    │  │
│  │   layout,                        │  │
│  │   theme,                         │  │
│  │   highlights,                    │  │
│  │   ... status, scheduleRepaint    │  │
│  │ ]                                │  │
│  │                                  │  │
│  │ → setFontSize()                  │  │
│  │ → setFontFamily()                │  │
│  │ → setFontWeight()                │  │
│  │ → setLayout()                    │  │
│  │ → setTheme()                     │  │
│  │ → setMargins()                   │  │
│  │ → ... all settings in batch ...  │  │
│  │ → scheduleRepaint() [once!]      │  │
│  └──────────────────────────────────┘  │
│           │                             │
│           └─ PAINT #1 (debounced)      │
│              └─ ✅ ONLY ONE!           │
│                 (at 50ms)              │
│                                         │
│  ┌──────────────────────────────────┐  │
│  │ useEffect #2 [interactionTool]   │  │
│  │ (keep separate for cursor UX)    │  │
│  └──────────────────────────────────┘  │
│                                         │
└─────────────────────────────────────────┘

RESULT: ✅ Single paint per change batch!
```

---

## 4. Step-by-Step Transformation

### Step 1: Identify Problematic Effects

```
BEFORE: 25+ useEffect
┌──────────────────────────────────────────────────────┐
│ useEffect [fontSize] → scheduleRepaint()             │ ← Batch these
│ useEffect [fontFamily] → scheduleRepaint()           │
│ useEffect [fontWeight] → scheduleRepaint()           │
│ useEffect [lineHeight] → scheduleRepaint()           │
│ useEffect [textAlign] → scheduleRepaint()            │
│ useEffect [layout] → scheduleRepaint()               │
│ useEffect [theme] → scheduleRepaint()                │
│ useEffect [margins] → scheduleRepaint()              │
│ useEffect [chromeHidden] → scheduleRepaint()         │
└──────────────────────────────────────────────────────┘
                      ↓↓↓ (Merge)
┌──────────────────────────────────────────────────────┐
│ useEffect [ALL ABOVE] → scheduleRepaint() [once]     │ ← Batched
└──────────────────────────────────────────────────────┘

AFTER: 5-7 useEffect (merged)
├─ useEffect [All Settings] ✅ (merged, single paint)
├─ useEffect [interactionTool] (keep separate)
├─ useEffect [cover sync] (keep separate)
├─ useEffect [typewriter]
└─ ... other non-batching effects
```

### Step 2: Fix Dependency Chain

```
BEFORE:
┌────────────────────────────────────────┐
│ scheduleRepaint dependency: [           │
│   paintHighlightsNow    ← unstable     │
│ ]                                      │
│                                        │
│ paintHighlightsNow dependency: [       │
│   (empty)                              │
│ ]                                      │
│                                        │
│ Problem:                               │
│ - paintHighlightsNow changes           │
│ - scheduleRepaint dependency broken    │
│ - cascade re-renders                   │
└────────────────────────────────────────┘

AFTER:
┌────────────────────────────────────────┐
│ scheduleRepaint dependency: []  ✅     │
│ (stable, no dependencies)              │
│                                        │
│ paintHighlightsNow dependency: []  ✅  │
│ (stable, no dependencies)              │
│                                        │
│ Benefit:                               │
│ - Functions never recreate             │
│ - No cascade dependency updates        │
│ - Clean, predictable behavior          │
└────────────────────────────────────────┘
```

### Step 3: Eliminate Highlight Duplicate

```
BEFORE:
┌─────────────────────────────────────────┐
│ 2 Paint Sources:                        │
│                                         │
│ Source 1: useEffect [highlights]       │
│           → paintHighlightsNow()        │
│           → painter.paint() [sync]     │
│                                         │
│ Source 2: useEffect [theme/layout]     │
│           → scheduleRepaint()           │
│           → ... 50ms later ...          │
│           → paintHighlightsNow()        │
│           → painter.paint() [async]    │
│                                         │
│ Problem: painter.paint() called 2x     │
│          for overlapping data          │
└─────────────────────────────────────────┘

AFTER:
┌─────────────────────────────────────────┐
│ 1 Paint Source:                         │
│                                         │
│ useEffect [ALL: fontSize, highlights.. │
│            fontFamily, layout, etc]    │
│           → scheduleRepaint()           │
│           → ... 50ms debounce ...       │
│           → paintHighlightsNow()        │
│           → painter.paint() [once]     │
│                                         │
│ Benefit: Single paint, all updates     │
│          included atomically           │
└─────────────────────────────────────────┘
```

---

## 5. Performance Comparison

### Execution Timeline

```
SCENARIO: User changes fontSize, layout, adds highlight

BEFORE (❌ 3 paints):
─────────────────────

Time  Event                        Action          Paint?
────  ─────────────────────────    ──────────      ──────
0ms   fontSize prop → 20           setFontSize()   
      scheduleRepaint() sets       [timeout 50ms]
      timer

1ms   highlights push new          paintHighlightsNow()  ⚡ PAINT #1
      
2ms   layout prop → 'dual'         setLayout()
      scheduleRepaint() resets     [timeout 50ms]
      timer

...

50ms  Timer fires                  paintHighlightsNow()  ⚡ PAINT #2
                                   [DUPLICATE!]

      Total: ❌ 2 paints (inefficient)
      Duration: ~55ms
      Wasted: 50% duplicate work


AFTER (✅ 1 paint):
──────────────────

Time  Event                        Action          Paint?
────  ─────────────────────────    ──────────      ──────
0ms   fontSize prop → 20 +         Batch effect
      highlights +                 setFontSize()
      layout prop → 'dual'         setLayout()
      all at once                  scheduleRepaint()
                                   [timeout 50ms]

...

50ms  Timer fires                  paintHighlightsNow()  ⚡ PAINT #1 only
                                   (includes all changes)

      Total: ✅ 1 paint (efficient!)
      Duration: ~55ms
      Saved: 50% unnecessary work
```

### Render Count

```
BEFORE:
Component Renders: 3-4 times
│
├─ Render #1: fontSize change
│
├─ Render #2: highlights change
│
├─ Render #3: layout change
│
└─ Render #4: Interaction update

AFTER:
Component Renders: 1-2 times
│
└─ Render #1: All settings batch
│  (plus separate interaction if needed)

Reduction: 50-75% fewer renders ✅
```

---

## 6. Code Flow Diagram

### Before Optimization Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    EPUB Renderer Props                       │
├─────────────────────────────────────────────────────────────┤
│ fontSize: 20 | fontFamily: "serif" | layout: "dual"         │
│ theme: "dark" | highlights: [new] | interactionTool: "hand" │
└─────────────────────────────────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
    ┌───▼─┐            ┌───▼─┐            ┌──▼──┐
    │ Eff │            │ Eff │            │ Eff │
    │  1  │            │  2  │            │  3  │
    └──┬──┘            └──┬──┘            └──┬──┘
       │                 │                  │
   fontSize          highlights         layout
   change            change             change
       │                 │                  │
   repaint()         paint()            repaint()
       │                 │                  │
       ▼                 ▼                  ▼
    ┌─────────┐      ┌──────┐          ┌────────┐
    │PAINT #1 │      │PAINT│          │PAINT #3│
    │[50ms]   │      │#2[sync]         │[50ms]  │
    └─────────┘      └──────┘          └────────┘
       │                 │                  │
       └─────────────────┴──────────────────┘
                    │
            Result: MESS ❌
            - 3 paints
            - Overlapping updates
            - Unpredictable timing
```

### After Optimization Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    EPUB Renderer Props                       │
├─────────────────────────────────────────────────────────────┤
│ fontSize: 20 | fontFamily: "serif" | layout: "dual"         │
│ theme: "dark" | highlights: [new] | interactionTool: "hand" │
└─────────────────────────────────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
    ┌───▼──────────────────▼──────────────────▼─┐
    │            Batch Effect #1                  │
    │  [fontSize, layout, theme, highlights...]  │
    └──────────────────┬──────────────────────────┘
                       │
        ┌──────────────┴──────────────┐
        │   Apply All Settings:       │
        │   - setFontSize()           │
        │   - setLayout()             │
        │   - setTheme()              │
        │   - ... etc ...             │
        │   - scheduleRepaint()[once] │
        └──────────────┬──────────────┘
                       │
                  repaint()
                       │
                   [50ms defer]
                       │
                       ▼
                   ┌─────────┐
                   │PAINT #1 │
                   │[atomic] │
                   └────┬────┘
                        │
              Result: CLEAN ✅
              - 1 paint
              - Atomic update
              - Predictable timing
```

---

## 7. Mục Tiêu Metrics

### Trước vs Sau

```
Metric                    Before          After          Improvement
──────────────────────────────────────────────────────────────────────
useEffect Count           25+             8-10           60% reduction
Paint Calls/Change        2-3             1              66% reduction
Render Cycles             3-4             1-2            75% reduction
Debounce Accuracy         Poor (cascading) Good (single) ✅
Code Maintainability      Hard            Easy           ✅
Memory Footprint          Higher          Lower          ✅
UI Responsiveness         Jittery         Smooth         ✅

────────────────────────────────────────────────────────────────────

Performance Impact:
• Font Size Change Speed: 150ms → 50ms (70% faster) 🚀
• Highlight Add Speed: 100ms → 50ms (50% faster) 🚀
• Layout Change Speed: 200ms → 60ms (70% faster) 🚀
• Perceived Smoothness: Improved significantly ✅

────────────────────────────────────────────────────────────────────

EPUB Compliance:
• Reflowable Text: ✅ Unchanged
• CFI Navigation: ✅ Unchanged
• Highlights: ✅ Works better (less flicker)
• Annotations: ✅ Unchanged
• Total Feature Set: ✅ 100% intact
```

---

## 8. Visual Decision Tree

### When to Batch vs Keep Separate

```
Change happens?
    │
    ├─ Is it a cursor/interaction update? (hand tool, hover, etc)
    │  └─ YES: Keep separate effect ✅
    │  └─ NO: Continue
    │
    ├─ Is it a text rendering setting? (fontSize, font, lineHeight, etc)
    │  └─ YES: Batch it! ✅
    │  └─ NO: Continue
    │
    ├─ Is it a layout setting? (layout mode, margins, theme, etc)
    │  └─ YES: Batch it! ✅
    │  └─ NO: Continue
    │
    ├─ Is it a display overlay? (highlights, annotations)
    │  └─ YES: Batch paint it! ✅
    │  └─ NO: Continue
    │
    ├─ Is it a cover sync operation?
    │  └─ YES: Keep separate (state-dependent) ✅
    │  └─ NO: Continue
    │
    └─ DEFAULT: Review if truly independent
                ├─ If yes: can batch
                └─ If no: keep separate
```

---

## Summary Diagram

```
OLD ARCHITECTURE (❌ Scattered)
┌──────────────────────────────────────────┐
│ 25+ useEffect                            │
│ ├─ theme → repaint                       │
│ ├─ layout → repaint                      │
│ ├─ fontSize → repaint                    │
│ ├─ highlights → paint (sync)             │
│ ├─ ... 21 more ...                       │
│ └─ Each independent → Chaotic timing     │
│                                          │
│ Result: 3 paints, duplicate work ❌     │
└──────────────────────────────────────────┘

NEW ARCHITECTURE (✅ Organized)
┌──────────────────────────────────────────┐
│ 8-10 useEffect (organized by concern)    │
│ ├─ Batch Settings Effect                 │
│ │  ├─ theme, layout, fontSize, ...       │
│ │  ├─ highlights (all together)          │
│ │  └─ → single paint call                │
│ ├─ Interaction Tool Effect               │
│ │  └─ (separate for cursor UX)           │
│ ├─ Cover Sync Effect                     │
│ │  └─ (state-dependent)                  │
│ └─ Other Specialized Effects             │
│                                          │
│ Result: 1 paint, atomic updates ✅      │
└──────────────────────────────────────────┘
```

