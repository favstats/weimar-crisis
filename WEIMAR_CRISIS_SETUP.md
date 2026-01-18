# Weimar Crisis - Setup Guide

A Secret Hitler-styled mobile app for expansion role distribution.

## Files Created

1. **`orban.html`** - The main mobile app (fully styled, mobile-ready)
2. **`weimar-crisis-backend.gs`** - Google Apps Script backend code

## Quick Start (Demo Mode)

Just open `orban.html` in a browser. Without API configuration, it runs in demo mode:
- Create games locally
- Test the UI flow
- Roles are assigned locally (not synced across devices)

## Full Setup (Multiplayer)

### Step 1: Create Google Sheet

1. Go to [Google Sheets](https://sheets.google.com)
2. Create a new blank spreadsheet
3. Name it "Weimar Crisis Games"
4. Copy the Sheet ID from the URL:
   ```
   https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID_HERE/edit
   ```

### Step 2: Deploy Apps Script

1. Go to [Google Apps Script](https://script.google.com)
2. Click "New Project"
3. Delete any existing code
4. Copy the entire contents of `weimar-crisis-backend.gs`
5. Paste into the script editor
6. Replace `YOUR_GOOGLE_SHEET_ID_HERE` with your Sheet ID from Step 1
7. Click "Deploy" → "New Deployment"
8. Configure:
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
9. Click "Deploy"
10. Copy the Web App URL

### Step 3: Configure Frontend

1. Open `orban.html` in a text editor
2. Find this line:
   ```javascript
   const API_URL = 'YOUR_APPS_SCRIPT_URL_HERE';
   ```
3. Replace with your Web App URL from Step 2

### Step 4: Test

1. Open `orban.html` in a browser
2. Create a new game
3. Copy the game code
4. Open in another browser/device
5. Join with the code
6. Host clicks "Deal Expansion Roles"
7. Each player taps to reveal their role

## Game Flow

```
┌──────────────┐
│ Start Screen │
│   Create or  │
│     Join     │
└──────┬───────┘
       │
┌──────▼───────┐
│ Enter Name   │
└──────┬───────┘
       │
┌──────▼───────┐
│    Lobby     │◄─── Players join here
│  (Host sees  │
│   all names) │
└──────┬───────┘
       │ Host clicks "Deal Roles"
┌──────▼───────┐
│ Reveal Card  │
│  (Tap to     │
│   reveal)    │
└──────┬───────┘
       │
┌──────▼───────┐
│  Role Card   │
│  Displayed   │
└──────────────┘
```

## Available Roles

| Role | German | Power |
|------|--------|-------|
| Police Chief | Polizeipräsident | Arrest a player |
| Assassin | Der Attentäter | Eliminate a player |
| Journalist | Der Reporter | Reveal a discarded policy |
| Industrialist | Der Großindustrielle | Force election to pass |
| Union Organizer | Der Gewerkschaftsführer | Force election to fail |
| Constitutional Judge | Der Verfassungsrichter | Block executive power |

Players beyond 6 receive "No Expansion Role" and play with standard Secret Hitler roles only.

## Mobile Usage

- Designed for phones (touch-friendly)
- Works offline in demo mode
- Refresh-safe (state saved in localStorage)
- Share game code via Copy button

## Troubleshooting

**"API not configured" message:**
- You haven't set up the Apps Script backend yet
- App works in demo mode (local only)

**"Game not found" when joining:**
- Check game code spelling
- Game may have expired
- Host may have left

**Roles not dealt:**
- Host must click "Deal Expansion Roles"
- Need at least 2 players
- Check if someone refreshed during dealing

## Customization

### Add/Remove Roles
Edit the `ROLES` object in both:
- `orban.html` (frontend display)
- `weimar-crisis-backend.gs` (backend assignment)

### Change Colors
Edit CSS variables in `orban.html`:
```css
:root {
    --fascist-red: #C23B22;
    --liberal-blue: #4A6FA5;
    --bg-red: #E8654A;
    --cream: #D4C5A9;
    --brown: #2C2416;
}
```

### Change Game Code Format
Edit `generateGameCode()` function in both files.
