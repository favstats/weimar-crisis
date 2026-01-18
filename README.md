# Weimar Crisis 🏛️

A mobile-ready multiplayer role assignment app for social deduction games, inspired by Secret Hitler but set in Weimar-era Germany.

**🎮 Play now:** [https://favstats.github.io/weimar-crisis/](https://favstats.github.io/weimar-crisis/)

## Features

- **Multiplayer lobbies** - Create or join games with a simple 6-character code
- **Power roles** - Special one-time abilities (Police Chief, Assassin, Journalist, etc.)
- **Behavior roles** - Character traits that guide how you should act (Feminist, Militarist, Aristocrat, etc.)
- **Host controls** - Configure which roles are in play (random, specific count, or hand-picked)
- **Mobile-first design** - Works great on phones and tablets
- **No app install required** - Pure web app, just share the link

## How to Play

1. **Host creates a game** → Share the 6-character code with players
2. **Players join** → Enter the code and their name
3. **Host configures roles** → Choose power roles and behavior roles
4. **Host deals roles** → Everyone receives their secret role
5. **Play your game!** → Use this alongside your physical game

## Role Types

### Power Roles (One-time abilities)
| Role | Power |
|------|-------|
| Police Chief | Arrest a player - they can't serve as President/Chancellor |
| The Assassin | Eliminate one player from the game |
| The Journalist | Force someone to reveal a discarded policy |
| The Industrialist | Cancel a policy and force a new legislative session |
| Union Organizer | Call a general strike to skip a legislative session |
| Constitutional Judge | Veto any policy before it's enacted |

### Behavior Roles (How you act)
Players without power roles may receive a behavior role that defines their character's personality and biases (e.g., Feminist, Monarchist, Pacifist, Veteran, etc.)

## Tech Stack

- **Frontend:** Pure HTML/CSS/JavaScript (no framework)
- **Backend:** Google Apps Script
- **Database:** Google Sheets
- **Hosting:** GitHub Pages

## Setup Your Own Instance

1. **Create a Google Sheet** with two tabs:
   - `Games` with columns: `gameCode`, `hostId`, `status`, `createdAt`, `rolesDealtAt`, `configData`
   - `Players` with columns: `gameCode`, `playerId`, `playerName`, `isHost`, `role`, `revealed`, `joinedAt`, `behavior`

2. **Deploy the Apps Script:**
   - Copy `weimar-crisis-backend.gs` to a new Google Apps Script project
   - Update `SHEET_ID` with your Google Sheet ID
   - Deploy as Web App (Execute as: Me, Access: Anyone)

3. **Update the frontend:**
   - Update `API_URL` in `index.html` with your deployed script URL
   - Host on GitHub Pages or any static host

## License

MIT - Feel free to fork and create your own themed version!
