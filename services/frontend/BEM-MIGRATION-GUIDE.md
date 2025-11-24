# BEM Naming Migration Guide

**Date**: November 18, 2025  
**Status**: CSS Refactoring Complete - React Components Update Pending

## Overview

Đã refactor toàn bộ CSS files sang BEM (Block__Element--Modifier) naming convention để tránh xung đột namespace và improve maintainability.

---

## 🎯 BEM Convention

**Format**: `.block__element--modifier`

- **Block**: Component độc lập (`.room`, `.translation`, `.captions`)
- **Element**: Part of block (`.room__header`, `.translation__content`)  
- **Modifier**: Variant/state (`.room--with-panel`, `.translation--open`)

---

## 📋 CSS Class Mapping

### Room.css - OLD → NEW Mapping

#### Container & Layout
```
.room-container          → .room
.room-container.with-panel → .room--with-panel
.video-content           → .room__video-content
.video-grid              → .room__video-grid
```

#### Header
```
.room-header             → .room__header
.room-header.hidden      → .room__header--hidden
.room-info               → .room__info
.room-time               → .room__time
.room-id-badge           → .room__id-badge
.connection-indicator    → .room__connection
.connection-indicator.good → .room__connection--good
.connection-indicator.fair → .room__connection--fair
.connection-indicator.poor → .room__connection--poor
.header-actions          → .room__header-actions
.icon-button             → .room__icon-btn
.icon-button.active      → .room__icon-btn--active
.more-menu-wrapper       → .room__more-menu-wrapper
.more-menu               → .room__more-menu
```

#### Video Grid & Tiles
```
.video-grid.participants-1 → .room__video-grid--p1
.video-grid.participants-2 → .room__video-grid--p2
.video-grid.participants-3 → .room__video-grid--p3
.video-grid.participants-4 → .room__video-grid--p4
... (up to p12)

.video-tile              → .room__video-tile
.video-tile.local        → .room__video-tile--local
.video-tile.speaking     → .room__video-tile--speaking
.video-element           → .room__video-element
.video-element.mirrored  → .room__video-element--mirrored
.video-avatar            → .room__video-avatar
.avatar-initials         → .room__avatar-initials
.video-overlay           → .room__video-overlay
.video-name              → .room__video-name
.video-status            → .room__video-status
.status-icon             → .room__status-icon
.status-icon.muted       → .room__status-icon--muted
```

#### Controls Bar
```
.controls-bar            → .room__controls
.controls-bar.hidden     → .room__controls--hidden
.control-button          → .room__control-btn
.control-button.active   → .room__control-btn--active
.control-button.danger   → .room__control-btn--danger
.control-button.muted    → .room__control-btn--muted
.control-label           → .room__control-label
```

#### Side Panels
```
.side-panel              → .room__side-panel
.side-panel.open         → .room__side-panel--open
.panel-header            → .room__panel-header
.panel-title             → .room__panel-title
.panel-close             → .room__panel-close
.panel-content           → .room__panel-content
.setting-group           → .room__setting-group
.setting-label           → .room__setting-label
.settings-note           → .room__settings-note
```

#### Meeting Details
```
.meeting-details-card    → .room__meeting-details
.meeting-details-card.hidden → .room__meeting-details--hidden
.details-toggle          → .room__details-toggle
.details-label           → .room__details-label
.details-room-code       → .room__details-code
.details-icon            → .room__details-icon
.details-icon.open       → .room__details-icon--open
.details-body            → .room__details-body
.details-row             → .room__details-row
.details-row.inline      → .room__details-row--inline
.details-row-label       → .room__details-row-label
.details-row-actions     → .room__details-row-actions
.details-value           → .room__details-value
.details-value.truncate  → .room__details-value--truncate
.details-action          → .room__details-action
.details-metric          → .room__details-metric
.metric-label            → .room__metric-label
.metric-value            → .room__metric-value
.copy-feedback           → .room__copy-feedback
```

#### Captions
```
.captions-overlay        → .room__captions
.caption-bubble          → .room__caption-bubble
.caption-speaker         → .room__caption-speaker
.caption-text            → .room__caption-text
.caption-translation     → .room__caption-translation
```

#### Loading & Error States
```
.loading-screen          → .room__loading
.loading-spinner         → .room__loading-spinner
.loading-text            → .room__loading-text
.error-screen            → .room__error
.error-icon              → .room__error-icon
.error-title             → .room__error-title
.error-message           → .room__error-message
.error-actions           → .room__error-actions
.button                  → .room__btn
.button-primary          → .room__btn--primary
.button-secondary        → .room__btn--secondary
```

---

### Translation.css - OLD → NEW Mapping

#### Translation Panel
```
.translation-controls    → .translation
.translation-controls.open → .translation--open
.translation-controls .panel-header → .translation__header
.translation-controls .panel-title  → .translation__title
.translation-controls .close-button → .translation__close-btn
.translation-controls .panel-content → .translation__content
```

#### Controls & Sections
```
.control-section         → .translation__section
.control-label           → .translation__label
.toggle-label            → .translation__toggle
.toggle-slider           → .translation__toggle-slider
.toggle-text             → .translation__toggle-text
.language-select         → .translation__select
```

#### Volume Control
```
.volume-control          → .translation__volume
.volume-slider           → .translation__volume-slider
.volume-value            → .translation__volume-value
```

#### Stats
```
.stats-toggle            → .translation__stats-toggle
.stats-display           → .translation__stats
.stat-item               → .translation__stat-item
.stat-label              → .translation__stat-label
.stat-value              → .translation__stat-value
.info-text               → .translation__info
```

#### Captions (Alternative to room__captions)
```
.captions-overlay        → .captions
.captions-container      → .captions__container
.caption-item            → .captions__item
.caption-original        → .captions__original
.caption-speaker         → .captions__speaker
.caption-original .caption-text → .captions__original-text
.caption-translated      → .captions__translated
.caption-arrow           → .captions__arrow
.caption-translated .caption-text → .captions__translated-text
```

---

## 🔧 React Components Update Required

### Files to Update:

1. **`/services/frontend/src/pages/RoomMeet.jsx`**
   - Update all `className` props with new BEM classes
   - Example: `className="room-container"` → `className="room"`
   - Conditional classes: `${hasOpenPanel ? 'with-panel' : ''}` → `${hasOpenPanel ? 'room--with-panel' : ''}`

2. **`/services/frontend/src/components/room/TranslationControls.jsx`**
   - Replace `className="translation-controls"` → `className="translation"`
   - Update `className={..isOpen ? 'open' : ''}` → `className={..isOpen ? 'translation--open' : ''}`
   - Update all nested classes: `panel-header` → `translation__header`, etc.

3. **`/services/frontend/src/components/room/VideoGrid.jsx`** (if exists)
   - Update video tile classes
   - Participant count modifiers: `.participants-${count}` → `.room__video-grid--p${count}`

4. **`/services/frontend/src/components/room/ControlsBar.jsx`** (if exists)
   - Update button classes: `control-button` → `room__control-btn`
   - Modifiers: `active`, `danger`, `muted` → `--active`, `--danger`, `--muted`

5. **`/services/frontend/src/components/room/CaptionsOverlay.jsx`** (if exists)
   - Update caption classes to BEM format

---

## 📝 React Component Update Pattern

### Example 1: Simple Class Replacement
```jsx
// OLD
<div className="room-container">

// NEW
<div className="room">
```

### Example 2: Conditional Modifier
```jsx
// OLD
<div className={`room-container ${hasOpenPanel ? 'with-panel' : ''}`}>

// NEW
<div className={`room ${hasOpenPanel ? 'room--with-panel' : ''}`}>
```

### Example 3: Multiple Classes
```jsx
// OLD
<button className={`control-button ${isActive ? 'active' : ''} ${isDanger ? 'danger' : ''}`}>

// NEW
<button className={`room__control-btn ${isActive ? 'room__control-btn--active' : ''} ${isDanger ? 'room__control-btn--danger' : ''}`}>
```

### Example 4: Participant Count Modifier
```jsx
// OLD
<div className={`video-grid participants-${count}`}>

// NEW
<div className={`room__video-grid room__video-grid--p${count}`}>
```

---

## ✅ Benefits of BEM

1. **No Name Collisions**: Each component has unique namespace
2. **Clear Hierarchy**: Easy to see parent-child relationships
3. **Self-Documenting**: Class names describe purpose and location
4. **Easy Refactoring**: Find/replace operations safer
5. **Better IDE Support**: Autocomplete works better with namespacing

---

## 🚀 Next Steps

1. **Search & Replace in React Components**:
   ```bash
   # Example for room-container
   find services/frontend/src -type f -name "*.jsx" -exec sed -i 's/room-container/room/g' {} +
   ```

2. **Manual Review Required**:
   - Conditional class logic
   - Dynamic class names with variables
   - Component props that pass className

3. **Test Thoroughly**:
   - All UI states (open/closed panels, active buttons, etc.)
   - Responsive breakpoints (desktop, tablet, mobile)
   - Different participant counts in video grid

4. **Rebuild & Deploy**:
   ```bash
   cd services/frontend
   docker build -t jackboun11/jbcalling-frontend:1.0.5-bem .
   docker push jackboun11/jbcalling-frontend:1.0.5-bem
   ```

---

## 📊 Impact Summary

- **Total Classes Refactored**: ~150+
- **Files Modified**: 2 (room.css, translation.css)
- **React Components Affected**: ~5-8 files
- **Breaking Changes**: YES - All className props need update
- **Backward Compatible**: NO - Old classes removed

---

## 🐛 Common Pitfalls to Avoid

1. **Don't mix old and new naming**: Will cause missing styles
2. **Update ALL instances**: Partial migration breaks UI
3. **Check nested selectors**: `.room__panel-header` not `.panel-header` inside `.room`
4. **Test all modifiers**: --active, --open, --hidden, etc.
5. **Verify responsive classes**: Mobile/tablet breakpoints use BEM too

---

**Status**: ✅ CSS Refactored | ⏳ React Components Pending | 🔄 Testing Needed
