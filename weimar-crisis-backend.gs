/**
 * Weimar Crisis - Google Apps Script Backend
 * 
 * SETUP INSTRUCTIONS:
 * 1. Go to script.google.com and create a new project
 * 2. Copy this entire file content into the script editor
 * 3. Click Deploy > New Deployment
 * 4. Select "Web app" as deployment type
 * 5. Set "Execute as" to "Me"
 * 6. Set "Who has access" to "Anyone"
 * 7. Click Deploy and copy the Web App URL
 * 8. Paste the URL into orban.html where it says API_URL
 * 9. Create a Google Sheet and copy its ID into SHEET_ID below
 */

// ==================== CONFIGURATION ====================
const SHEET_ID = 'YOUR_GOOGLE_SHEET_ID_HERE'; // Replace with your Google Sheet ID
const GAMES_SHEET = 'Games';
const PLAYERS_SHEET = 'Players';

// Available roles
const ROLES = [
  'police_chief',
  'assassin', 
  'journalist',
  'industrialist',
  'union_organizer',
  'constitutional_judge'
];

// ==================== WEB APP ENTRY POINTS ====================

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  // Enable CORS
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);
  
  try {
    const action = e.parameter.action;
    let result;
    
    switch(action) {
      case 'createGame':
        result = createGame(e.parameter.hostName);
        break;
      case 'joinGame':
        result = joinGame(e.parameter.gameCode, e.parameter.playerName);
        break;
      case 'getPlayers':
        result = getPlayers(e.parameter.gameCode);
        break;
      case 'dealRoles':
        result = dealRoles(e.parameter.gameCode, e.parameter.playerId);
        break;
      case 'getMyRole':
        result = getMyRole(e.parameter.gameCode, e.parameter.playerId);
        break;
      case 'checkGameStatus':
        result = checkGameStatus(e.parameter.gameCode);
        break;
      default:
        result = { success: false, error: 'Unknown action' };
    }
    
    output.setContent(JSON.stringify(result));
  } catch (error) {
    output.setContent(JSON.stringify({ 
      success: false, 
      error: error.toString() 
    }));
  }
  
  return output;
}

// ==================== GAME FUNCTIONS ====================

/**
 * Create a new game
 * @param {string} hostName - Name of the host player
 * @returns {object} Game code and player ID
 */
function createGame(hostName) {
  if (!hostName) {
    return { success: false, error: 'Host name is required' };
  }
  
  const ss = SpreadsheetApp.openById(SHEET_ID);
  
  // Ensure sheets exist
  ensureSheetsExist(ss);
  
  // Generate unique game code
  const gameCode = generateGameCode();
  const playerId = generatePlayerId();
  const timestamp = new Date().toISOString();
  
  // Add game to Games sheet
  const gamesSheet = ss.getSheetByName(GAMES_SHEET);
  gamesSheet.appendRow([
    gameCode,
    playerId,  // hostId
    'waiting', // status: waiting, dealing, dealt
    timestamp,
    ''         // roles dealt timestamp
  ]);
  
  // Add host to Players sheet
  const playersSheet = ss.getSheetByName(PLAYERS_SHEET);
  playersSheet.appendRow([
    gameCode,
    playerId,
    hostName,
    true,      // isHost
    '',        // role (empty until dealt)
    false,     // revealed
    timestamp
  ]);
  
  return {
    success: true,
    gameCode: gameCode,
    playerId: playerId,
    isHost: true
  };
}

/**
 * Join an existing game
 * @param {string} gameCode - The game code to join
 * @param {string} playerName - Name of the joining player
 * @returns {object} Player ID and game info
 */
function joinGame(gameCode, playerName) {
  if (!gameCode || !playerName) {
    return { success: false, error: 'Game code and player name are required' };
  }
  
  gameCode = gameCode.toUpperCase().trim();
  
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const gamesSheet = ss.getSheetByName(GAMES_SHEET);
  const playersSheet = ss.getSheetByName(PLAYERS_SHEET);
  
  // Check if game exists
  const gamesData = gamesSheet.getDataRange().getValues();
  let gameExists = false;
  let gameStatus = '';
  
  for (let i = 1; i < gamesData.length; i++) {
    if (gamesData[i][0] === gameCode) {
      gameExists = true;
      gameStatus = gamesData[i][2];
      break;
    }
  }
  
  if (!gameExists) {
    return { success: false, error: 'Game not found' };
  }
  
  if (gameStatus === 'dealt') {
    return { success: false, error: 'Game has already started' };
  }
  
  // Check player count (max 10)
  const playersData = playersSheet.getDataRange().getValues();
  let playerCount = 0;
  for (let i = 1; i < playersData.length; i++) {
    if (playersData[i][0] === gameCode) {
      playerCount++;
    }
  }
  
  if (playerCount >= 10) {
    return { success: false, error: 'Game is full (max 10 players)' };
  }
  
  // Add player
  const playerId = generatePlayerId();
  const timestamp = new Date().toISOString();
  
  playersSheet.appendRow([
    gameCode,
    playerId,
    playerName,
    false,     // isHost
    '',        // role
    false,     // revealed
    timestamp
  ]);
  
  return {
    success: true,
    gameCode: gameCode,
    playerId: playerId,
    isHost: false
  };
}

/**
 * Get all players in a game
 * @param {string} gameCode - The game code
 * @returns {object} List of players
 */
function getPlayers(gameCode) {
  if (!gameCode) {
    return { success: false, error: 'Game code is required' };
  }
  
  gameCode = gameCode.toUpperCase().trim();
  
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const playersSheet = ss.getSheetByName(PLAYERS_SHEET);
  const gamesSheet = ss.getSheetByName(GAMES_SHEET);
  
  // Get game status
  const gamesData = gamesSheet.getDataRange().getValues();
  let gameStatus = 'waiting';
  for (let i = 1; i < gamesData.length; i++) {
    if (gamesData[i][0] === gameCode) {
      gameStatus = gamesData[i][2];
      break;
    }
  }
  
  // Get players
  const playersData = playersSheet.getDataRange().getValues();
  const players = [];
  
  for (let i = 1; i < playersData.length; i++) {
    if (playersData[i][0] === gameCode) {
      players.push({
        id: playersData[i][1],
        name: playersData[i][2],
        isHost: playersData[i][3] === true || playersData[i][3] === 'TRUE'
      });
    }
  }
  
  return {
    success: true,
    players: players,
    gameStatus: gameStatus,
    rolesDealt: gameStatus === 'dealt'
  };
}

/**
 * Deal roles to all players (host only)
 * @param {string} gameCode - The game code
 * @param {string} playerId - The requesting player's ID (must be host)
 * @returns {object} Success status
 */
function dealRoles(gameCode, playerId) {
  if (!gameCode || !playerId) {
    return { success: false, error: 'Game code and player ID are required' };
  }
  
  gameCode = gameCode.toUpperCase().trim();
  
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const gamesSheet = ss.getSheetByName(GAMES_SHEET);
  const playersSheet = ss.getSheetByName(PLAYERS_SHEET);
  
  // Verify requester is host
  const gamesData = gamesSheet.getDataRange().getValues();
  let gameRow = -1;
  let hostId = '';
  
  for (let i = 1; i < gamesData.length; i++) {
    if (gamesData[i][0] === gameCode) {
      gameRow = i + 1;
      hostId = gamesData[i][1];
      break;
    }
  }
  
  if (gameRow === -1) {
    return { success: false, error: 'Game not found' };
  }
  
  if (hostId !== playerId) {
    return { success: false, error: 'Only the host can deal roles' };
  }
  
  // Get all players in this game
  const playersData = playersSheet.getDataRange().getValues();
  const playerRows = [];
  
  for (let i = 1; i < playersData.length; i++) {
    if (playersData[i][0] === gameCode) {
      playerRows.push({
        row: i + 1,
        id: playersData[i][1]
      });
    }
  }
  
  if (playerRows.length < 2) {
    return { success: false, error: 'Need at least 2 players to deal roles' };
  }
  
  // Shuffle roles
  const shuffledRoles = shuffleArray([...ROLES]);
  
  // Assign roles to players
  for (let i = 0; i < playerRows.length; i++) {
    const role = i < shuffledRoles.length ? shuffledRoles[i] : 'no_role';
    playersSheet.getRange(playerRows[i].row, 5).setValue(role); // Column E = role
  }
  
  // Update game status
  const timestamp = new Date().toISOString();
  gamesSheet.getRange(gameRow, 3).setValue('dealt');
  gamesSheet.getRange(gameRow, 5).setValue(timestamp);
  
  return {
    success: true,
    message: 'Roles dealt successfully',
    playerCount: playerRows.length
  };
}

/**
 * Get a player's assigned role
 * @param {string} gameCode - The game code
 * @param {string} playerId - The player's ID
 * @returns {object} The player's role
 */
function getMyRole(gameCode, playerId) {
  if (!gameCode || !playerId) {
    return { success: false, error: 'Game code and player ID are required' };
  }
  
  gameCode = gameCode.toUpperCase().trim();
  
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const playersSheet = ss.getSheetByName(PLAYERS_SHEET);
  
  const playersData = playersSheet.getDataRange().getValues();
  
  for (let i = 1; i < playersData.length; i++) {
    if (playersData[i][0] === gameCode && playersData[i][1] === playerId) {
      const role = playersData[i][4];
      
      if (!role) {
        return { success: false, error: 'Roles have not been dealt yet' };
      }
      
      // Mark as revealed
      playersSheet.getRange(i + 1, 6).setValue(true);
      
      return {
        success: true,
        role: role
      };
    }
  }
  
  return { success: false, error: 'Player not found in this game' };
}

/**
 * Check game status (for polling)
 * @param {string} gameCode - The game code
 * @returns {object} Game status and whether roles are dealt
 */
function checkGameStatus(gameCode) {
  if (!gameCode) {
    return { success: false, error: 'Game code is required' };
  }
  
  gameCode = gameCode.toUpperCase().trim();
  
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const gamesSheet = ss.getSheetByName(GAMES_SHEET);
  
  const gamesData = gamesSheet.getDataRange().getValues();
  
  for (let i = 1; i < gamesData.length; i++) {
    if (gamesData[i][0] === gameCode) {
      return {
        success: true,
        status: gamesData[i][2],
        rolesDealt: gamesData[i][2] === 'dealt'
      };
    }
  }
  
  return { success: false, error: 'Game not found' };
}

// ==================== UTILITY FUNCTIONS ====================

/**
 * Ensure required sheets exist
 */
function ensureSheetsExist(ss) {
  let gamesSheet = ss.getSheetByName(GAMES_SHEET);
  if (!gamesSheet) {
    gamesSheet = ss.insertSheet(GAMES_SHEET);
    gamesSheet.appendRow(['gameCode', 'hostId', 'status', 'createdAt', 'rolesDealtAt']);
  }
  
  let playersSheet = ss.getSheetByName(PLAYERS_SHEET);
  if (!playersSheet) {
    playersSheet = ss.insertSheet(PLAYERS_SHEET);
    playersSheet.appendRow(['gameCode', 'playerId', 'playerName', 'isHost', 'role', 'revealed', 'joinedAt']);
  }
}

/**
 * Generate a unique game code (4 letters + 2 numbers, e.g., ABCD12)
 */
function generateGameCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const numbers = '0123456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += letters.charAt(Math.floor(Math.random() * letters.length));
  }
  for (let i = 0; i < 2; i++) {
    code += numbers.charAt(Math.floor(Math.random() * numbers.length));
  }
  return code;
}

/**
 * Generate a unique player ID
 */
function generatePlayerId() {
  return 'p_' + Utilities.getUuid().replace(/-/g, '').substring(0, 12);
}

/**
 * Shuffle an array (Fisher-Yates)
 */
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// ==================== TEST FUNCTION ====================

/**
 * Test function - run this to verify setup
 */
function testSetup() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  ensureSheetsExist(ss);
  Logger.log('Setup complete! Sheets created: ' + GAMES_SHEET + ', ' + PLAYERS_SHEET);
}
