# 🔧 Hướng Khắc Phục Render 3 Lần - Project 1

## 1. Root Cause Analysis: Tại Sao Render 3 Lần?

### Vấn Đề Chính

```typescript
// 25+ useEffect trong EpubRenderer.tsx (dòng 1248-2651)
useEffect(() => { handleRef.current?.setTheme(theme); scheduleRepaint() }, [theme, scheduleRepaint])
useEffect(() => { paintHighlightsNow() }, [highlights, status, paintHighlightsNow])
useEffect(() => { handleRef.current?.setLayout(layout); scheduleRepaint() }, [layout, scheduleRepaint])
useEffect(() => { handleRef.current?.setFontSize(fontSize); scheduleRepaint() }, [fontSize, scheduleRepaint])
useEffect(() => { handleRef.current?.setFontFamily(fontFamily); scheduleRepaint() }, [fontFamily, scheduleRepaint])
useEffect(() => { handleRef.current?.setFontWeight(fontWeight); scheduleRepaint() }, [fontWeight, scheduleRepaint])
useEffect(() => { handleRef.current?.setLineHeight(lineHeight); scheduleRepaint() }, [lineHeight, scheduleRepaint])
useEffect(() => { handleRef.current?.setTextAlign(textAlign); scheduleRepaint() }, [textAlign, scheduleRepaint])
useEffect(() => { handleRef.current?.setMargins(...); scheduleRepaint() }, [marginPreset, marginsEnabled, scheduleRepaint])
useEffect(() => { handleRef.current?.setChromeHidden(chromeHidden); scheduleRepaint() }, [chromeHidden, scheduleRepaint])
// ... và 15 useEffect khác
```

### Render Cycle Hiện Tại (Bad ❌)

```
Scenario: User thay đổi font size + highlights thêm 1 mark

Time | Event                              | Action              | Re-render?
-----|-----------------------------------|-------------------|----------
T0   | fontSize prop change              | setFontSize()      | Render #1
     |                                   | scheduleRepaint()   |
     |                                   | (setTimeout 50ms)   |
-----|-----------------------------------|-------------------|----------
T1   | highlights prop change            | paintHighlightsNow()| Render #2
     |                                   | painter.paint()     |
     |                                   | (sync)              |
-----|-----------------------------------|-------------------|----------
T50  | scheduleRepaint timeout fire       | paintHighlightsNow()| Render #3
     |                                   | painter.paint()     |
     |                                   | (trùng lặp!)        |
-----|-----------------------------------|-------------------|----------
```

### Tại Sao Xảy Ra 3 Lần:

1. **Lần 1**: `fontSize` change → useEffect trigger → `scheduleRepaint()` setup timeout
2. **Lần 2**: `highlights` change → useEffect trigger → `paintHighlightsNow()` chạy ngay (sync)
3. **Lần 3**: 50ms timeout from fontSize → `paintHighlightsNow()` chạy lại (trùng lặp!)

**Problem**: Không có batch, không có dedup. Mỗi setting thay đổi trigger paint riêng.

---

## 2. Cấu Trúc Hiện Tại vs Tối Ưu

### Architecture Hiện Tại (reading-book-app)

```
Props Change
   ↓
25+ useEffect (mỗi setting có 1 effect)
   ├─ fontSize → setFontSize() → scheduleRepaint()
   ├─ layout → setLayout() → scheduleRepaint()
   ├─ theme → setTheme() → scheduleRepaint()
   ├─ highlights → paintHighlightsNow() (sync)
   └─ ... 21 effect khác
   ↓
scheduleRepaint() [debounce 50ms]
   ↓
paintHighlightsNow()
   ↓
painter.paint() [full overlay repaint]
   ↓
iframe re-render ❌ 3 LẦN
```

### Kiến Trúc Tối Ưu (Target)

```
Props Change
   ↓
1 useEffect [merged dependencies]
   ├─ Batch collect all changes:
   │  ├─ fontSettings = { size, family, weight, lineHeight, align }
   │  ├─ layoutSettings = { layout, theme, margins, chrome }
   │  └─ highlightList = new highlights
   ├─ Apply in single batch:
   │  ├─ epubjs.setFontSize/Family/etc (no repaint between)
   │  └─ overlay.paint({ highlights }) (single paint call)
   ↓
Single debounced paint [50ms]
   ↓
painter.paint() [incremental update if possible]
   ↓
iframe re-render ✅ 1 LẦN
```

---

## 3. Giải Pháp Chi Tiết

### Phase 1: Batch useEffect Khối Liên Quan

**File**: `EpubRenderer.tsx`

**Hiện Tại** (lines 2159-2208):
```typescript
// ❌ 10 useEffect riêng lẻ
useEffect(() => {
  handleRef.current?.setTheme(theme)
  scheduleRepaint()
}, [theme, scheduleRepaint])

useEffect(() => {
  handleRef.current?.setFontSize(fontSize)
  scheduleRepaint()
}, [fontSize, scheduleRepaint])

// ... 8 useEffect khác
```

**Tối Ưu**:
```typescript
// ✅ 1 useEffect batch tất cả
useEffect(() => {
  if (status !== 'ready') return
  const handle = handleRef.current
  if (!handle) return

  // Batch 1: Layout & Display Settings
  handle.setTheme(theme)
  handle.setLayout(layout)
  handle.setChromeHidden(chromeHidden)
  
  // Batch 2: Text Rendering Settings (cùng trigger một repaint)
  handle.setFontSize(fontSize)
  handle.setFontFamily(fontFamily)
  handle.setFontWeight(fontWeight)
  handle.setLineHeight(lineHeight)
  handle.setTextAlign(textAlign)
  
  // Batch 3: Margin Settings
  handle.setMargins(marginsEnabled, marginPreset)
  
  // Trigger repaint một lần duy nhất
  scheduleRepaint()
}, [
  theme, layout, chromeHidden,
  fontSize, fontFamily, fontWeight, lineHeight, textAlign,
  marginsEnabled, marginPreset,
  status, scheduleRepaint
])
```

**Lợi ích**: 
- Từ 10 useEffect → 1 useEffect
- Tất cả setting changes → 1 repaint (thay vì 10 repaint)
- Giảm 90% unnecessary renders

---

### Phase 2: Dedup Highlight Painting

**Hiện Tại** (lines 2165-2168):
```typescript
// ❌ Mỗi highlights change → paint ngay
useEffect(() => {
  if (status !== 'ready') return
  paintHighlightsNow()  // sync paint
}, [highlights, status, paintHighlightsNow])
```

**Vấn Đề**:
- Nếu highlights change + fontSize change cùng lúc → 2 paint
- Nếu fontSize → scheduleRepaint() → 50ms → paint lại → 3 paint total

**Tối Ưu**:
```typescript
// ✅ Merge highlight paint với settings batch
const needsHighlightRepaint = useRef(false)

// Batch settings + mark if highlights changed
useEffect(() => {
  if (status !== 'ready') return
  const handle = handleRef.current
  if (!handle) return

  // Check if highlights actually changed
  const oldHighlights = highlightsRef.current
  const newHighlights = highlights
  if (oldHighlights !== newHighlights) {
    highlightsRef.current = newHighlights
    needsHighlightRepaint.current = true
  }

  // Batch all settings
  handle.setTheme(theme)
  handle.setLayout(layout)
  handle.setFontSize(fontSize)
  // ... other settings

  // Trigger single paint
  scheduleRepaint()
}, [
  theme, layout, fontSize, fontFamily, fontWeight, 
  lineHeight, textAlign, marginsEnabled, marginPreset, 
  chromeHidden, highlights, status, scheduleRepaint
])

// Paint happens in scheduleRepaint's timeout
const paintHighlightsNow = useCallback(() => {
  const painter = overlayPainterRef.current
  if (!painter) return
  
  // Paint highlights + other updates atomically
  const domain = epubHighlightsToDomain(highlightsRef.current)
  void painter.paint({ 
    highlights: domain,
    // Có thể thêm incremental update info nếu cần
  })
}, [])
```

**Lợi ích**:
- Eliminate duplicate paints
- Single paint call cho toàn bộ changes
- Từ 3 paint → 1 paint

---

### Phase 3: Optimize scheduleRepaint Debounce

**Hiện Tại** (lines 1235-1246):
```typescript
const scheduleRepaint = useCallback(() => {
  if (!overlayPainterRef.current) return
  if (repaintTimerRef.current != null) {
    window.clearTimeout(repaintTimerRef.current)
  }
  repaintTimerRef.current = window.setTimeout(() => {
    repaintTimerRef.current = null
    paintHighlightsNow()
  }, 50)
}, [paintHighlightsNow])
```

**Vấn đề**: 
- `paintHighlightsNow` dependency không stable → mỗi render new function
- scheduleRepaint cũng được re-create → trigger useEffect lại

**Tối Ưu**:
```typescript
const repaintTimerRef = useRef<number | null>(null)
const repaintFlagRef = useRef(false)

const scheduleRepaint = useCallback(() => {
  if (!overlayPainterRef.current) return
  repaintFlagRef.current = true
  
  if (repaintTimerRef.current != null) {
    return // Already scheduled
  }
  
  repaintTimerRef.current = window.setTimeout(() => {
    repaintTimerRef.current = null
    if (repaintFlagRef.current) {
      repaintFlagRef.current = false
      const painter = overlayPainterRef.current
      if (painter) {
        const domain = epubHighlightsToDomain(highlightsRef.current)
        void painter.paint({ highlights: domain })
      }
    }
  }, 50)
}, [])  // ✅ Empty dependency - stable function

const paintHighlightsNow = useCallback(() => {
  const painter = overlayPainterRef.current
  if (!painter) return
  const domain = epubHighlightsToDomain(highlightsRef.current)
  void painter.paint({ highlights: domain })
}, [])  // ✅ Empty dependency - stable function
```

**Lợi ích**:
- `scheduleRepaint` là stable function
- Không trigger infinite useEffect loops
- Cleaner dependency arrays

---

## 4. Implementation Checklist

### Step 1: Consolidate useEffect (1-2 hours)
- [ ] Merge font settings useEffect (fontSize, fontFamily, fontWeight, lineHeight, textAlign)
- [ ] Merge layout settings useEffect (layout, theme, margins, chromeHidden)
- [ ] Verify no regression in font/layout changes
- [ ] Test: Change multiple settings → should see 1 repaint in DevTools

### Step 2: Fix scheduleRepaint Dependency (30 mins)
- [ ] Make `paintHighlightsNow` dependency stable
- [ ] Make `scheduleRepaint` dependency stable
- [ ] Remove `paintHighlightsNow` from `scheduleRepaint` dependency
- [ ] Test: No console warnings about dependencies

### Step 3: Deduplicate Highlight Paints (1 hour)
- [ ] Track when highlights actually change
- [ ] Merge highlight paint into settings batch
- [ ] Remove duplicate highlight effect
- [ ] Test: Add/edit highlight → should see 1 paint only

### Step 4: Refactor Remaining Effects (2 hours)
- [ ] Review other useEffect (interaction, gesture, drag, etc)
- [ ] Consolidate related ones (e.g., all cursor/interaction effects)
- [ ] Test: Each feature still works correctly

### Step 5: Performance Test (1 hour)
- [ ] Open DevTools → Performance tab
- [ ] Record: Change font size, add highlight, change layout
- [ ] Before: 3 renders, multiple paints
- [ ] After: 1 render, 1 paint
- [ ] Measure: Time reduction (should be ~60% faster)

---

## 5. Mục Tiêu Tối Ưu

### Trước (Current)
```
Render Cycle: 3 lần
Paint Calls: 2-3 lần
Performance Hit: ~300ms per setting change
Code Complexity: 25+ useEffect → khó maintain
```

### Sau (Target)
```
Render Cycle: 1 lần ✅
Paint Calls: 1 lần ✅
Performance Hit: ~100ms per setting change (70% improvement) ✅
Code Complexity: 5-7 useEffect → dễ maintain ✅
```

### EPUB Compliance ✅
- **Vẫn giữ**: Reflowable text (không page cố định)
- **Vẫn giữ**: CFI navigation (positioning)
- **Vẫn giữ**: Highlights, annotations, typewriter
- **Thay đổi**: Chỉ optimize render cycle, không thay đổi logic

---

## 6. Cảnh Báo & Edge Cases

### ⚠️ Cảnh báo

1. **Don't batch interactionTool changes** - cần immediate cursor update
   ```typescript
   // Keep riêng này
   useEffect(() => {
     applyInteractionToolSurface(host, interactionTool, {...})
   }, [interactionTool, drawingTool, status])
   ```

2. **Don't batch cover sync** - cần check state timing
   ```typescript
   // Keep riêng này
   useEffect(() => {
     if (pageMode === 'scroll') {
       syncContinuousScrollCover(host, coverUrl)
     }
   }, [pageMode, coverUrl, status])
   ```

3. **Test highlight painting incremental** - xem painter.paint() có hỗ trợ incremental không
   ```typescript
   // If painter doesn't support incremental:
   void painter.paint({ highlights: domain })
   
   // If it does (project 2 có?):
   void painter.paint({ 
     highlights: domain,
     changed: newHighlights.filter(h => !oldHighlights.find(oh => oh.id === h.id))
   })
   ```

### 📋 Edge Cases

1. **Multiple rapid setting changes** - Debounce xử lý tốt
2. **Highlights + font size change simultaneously** - Batch xử lý
3. **Resize + layout change** - Test không conflict
4. **Zoom + font size change** - Verify math chính xác

---

## 7. Bonus: Học từ Project 2

### Project 2 Làm Gì Tốt

✅ **Simplified drawing** (pencil only) → ít complexity
✅ **Preview cache system** → không render toàn bộ
✅ **Jump viewport hidden** → UX mượt hơn
✅ **Modular file split** (interaction-hit.ts, typewriterBoxDrag.ts)

### Có Thể Thêm (Sau này)

```typescript
// Tương tự Project 2, thêm preview cache cho highlights
const highlightsPaintCacheRef = useRef<Map<string, CachedHighlight>>(new Map())

const paintHighlightsNow = useCallback(() => {
  const painter = overlayPainterRef.current
  if (!painter) return
  
  // Incremental: chỉ paint highlights thay đổi
  const domain = epubHighlightsToDomain(highlightsRef.current)
  const changed = domain.filter(h => 
    !highlightsPaintCacheRef.current.has(h.id)
  )
  
  void painter.paint({ 
    highlights: domain,
    changed  // Hint to painter for incremental update
  })
  
  // Update cache
  domain.forEach(h => highlightsPaintCacheRef.current.set(h.id, h))
}, [])
```

---

## 8. Timeline & Effort

| Phase | Task | Effort | Risk |
|-------|------|--------|------|
| 1 | Consolidate useEffect | 2h | Low |
| 2 | Fix scheduleRepaint | 0.5h | Very Low |
| 3 | Deduplicate paints | 1h | Low |
| 4 | Refactor remaining | 2h | Low-Medium |
| 5 | Performance test | 1h | Low |
| **Total** | **Full Optimization** | **6.5h** | **Low-Medium** |

**After Optimization**: Expected 70% performance improvement while keeping EPUB rendering intact.
