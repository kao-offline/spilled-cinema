# Carousel Rebuild Prompt

**Problem:** The carousels on the Explore page don't work. They don't scroll, drag, or show arrow buttons. Arrows aren't being portaled to the body. Existing implementations (HorizontalCarousel, NewCarousel) are broken.

**Task:** Ignore the current carousel structure entirely. Delete all existing carousel components and rebuild from scratch with a simple, working implementation.

## Requirements

1. **Location & Usage:**
   - Component: `apps/dashboard/src/components/DiscoveryRail.tsx`
   - Used in: `ExploreView.tsx` (renders multiple rails with `<DiscoveryRail key={section.key} title={section.title} subtitle={section.subtitle} countLabel={count} children={items} />`)
   - Items are: `<DiscoveryItemCard item={item} onClick={setSelectedItem} />`

2. **Behavior:**
   - Horizontal scrolling via:
     - Mouse wheel (detect scroll direction, allow horizontal pan)
     - Click-and-drag (pointer down → move → up)
     - Left/Right arrow buttons (click to scroll by ~300px)
     - Keyboard arrow keys (focus rail, press Left/Right to scroll)
   - Show/hide arrow buttons based on scroll position
   - Smooth scroll on button click

3. **Layout:**
   - Title + subtitle + count label on top (no outer frame/border)
   - Below: a horizontally scrollable flex container with gap-4
   - Arrow buttons: only visible when scrollable; position fixed outside the rail DOM (use portal to document.body)
   - No rounded border, no extra padding, no outer container styling

4. **Technical:**
   - Use React, TypeScript, lucide-react icons (ChevronLeft, ChevronRight)
   - Use Tailwind for styling (flex, overflow-x-auto, gap-4, snap-x snap-mandatory)
   - Pointer events (setPointerCapture for reliable drag)
   - ResizeObserver to track scrollable state changes
   - Portal arrows to document.body to prevent clipping

5. **Delete:**
   - Remove `HorizontalCarousel.tsx` (unused)
   - Remove `NewCarousel.tsx` (unused)
   - Any other carousel-related dead code

## Success Criteria

- Rows are horizontally scrollable by dragging
- Left/Right arrow buttons appear at row edges when content overflows
- Buttons disappear when fully scrolled
- Wheel scroll works
- Keyboard arrow keys work
- No visible gray/border frame around items
- Items display cleanly with just a gap between them
