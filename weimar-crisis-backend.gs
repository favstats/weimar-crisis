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
 * 8. Paste the URL into index.html where it says API_URL
 * 9. Create a Google Sheet and copy its ID into SHEET_ID below
 */

// ==================== CONFIGURATION ====================
const SHEET_ID = 'YOUR_GOOGLE_SHEET_ID_HERE'; // Replace with your Google Sheet ID
const GAMES_SHEET = 'Games';
const PLAYERS_SHEET = 'Players';

// Available power roles
const ROLES = [
  'police_chief',
  'assassin', 
  'journalist',
  'industrialist',
  'union_organizer',
  'constitutional_judge'
];

// Available behavior roles
const BEHAVIORS = [
  'feminist', 'misogynist', 'aristocrat', 'proletarian', 
  'pacifist', 'militarist', 'monarchist', 'revolutionary',
  'prussian', 'bavarian', 'devout', 'atheist', 
  'academic', 'worker', 'veteran', 
  'paranoid', 'optimist', 'cynic', 'hothead'
];

// ==================== WEB APP ENTRY POINTS ====================

function doGet(e) {
  // Handle GET requests (for simple tests)
  return handleRequest(e.parameter);
}

function doPost(e) {
  // Handle POST requests with JSON body
  let params = {};
  
  try {
    if (e.postData && e.postData.contents) {
      params = JSON.parse(e.postData.contents);
    }
  } catch (err) {
    // Fallback to URL parameters
    params = e.parameter || {};
  }
  
  return handleRequest(params);
}

function handleRequest(params) {
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);
  
  try {
    const action = params.action;
    let result;
    
    switch(action) {
      case 'createGame':
        result = createGame(params.hostName, params.roleConfig);
        break;
      case 'joinGame':
        result = joinGame(params.gameCode, params.playerName);
        break;
      case 'getPlayers':
        result = getPlayers(params.gameCode);
        break;
      case 'dealRoles':
        result = dealRoles(params.gameCode, params.playerId);
        break;
      case 'getMyRole':
        result = getMyRole(params.gameCode, params.playerId);
        break;
      case 'checkGameStatus':
        result = checkGameStatus(params.gameCode);
        break;
      case 'updateRoleConfig':
        result = updateRoleConfig(params.gameCode, params.playerId, params.roleConfig, params.behaviorConfig);
        break;
      case 'getRoleConfig':
        result = getRoleConfig(params.gameCode);
        break;
      default:
        result = { success: false, error: 'Unknown action: ' + action };
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
 * @param {object} roleConfig - Optional role configuration
 * @returns {object} Game code and player ID
 */
function createGame(hostName, roleConfig) {
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
  
  // Default role config: all roles, randomized
  const defaultRoleConfig = {
    mode: 'random', // 'random', 'specific', or 'count'
    count: 6,       // number of special roles (when mode is 'count')
    roles: ROLES    // specific roles to use
  };
  
  const finalRoleConfig = roleConfig || defaultRoleConfig;
  
  // Add game to Games sheet
  const gamesSheet = ss.getSheetByName(GAMES_SHEET);
  gamesSheet.appendRow([
    gameCode,
    playerId,  // hostId
    'waiting', // status: waiting, dealing, dealt
    timestamp,
    '',        // roles dealt timestamp
    JSON.stringify(finalRoleConfig) // role configuration
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
    isHost: true,
    roleConfig: finalRoleConfig
  };
}

/**
 * Join an existing game (NO PLAYER LIMIT)
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
  
  // Add player (NO LIMIT)
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
  
  // Get game status and role config
  const gamesData = gamesSheet.getDataRange().getValues();
  let gameStatus = 'waiting';
  let roleConfig = null;
  
  for (let i = 1; i < gamesData.length; i++) {
    if (gamesData[i][0] === gameCode) {
      gameStatus = gamesData[i][2];
      try {
        roleConfig = JSON.parse(gamesData[i][5] || '{}');
      } catch (e) {
        roleConfig = {};
      }
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
    rolesDealt: gameStatus === 'dealt',
    roleConfig: roleConfig
  };
}

/**
 * Update role configuration (host only)
 * @param {string} gameCode - The game code
 * @param {string} playerId - The requesting player's ID (must be host)
 * @param {object} roleConfig - The power role configuration
 * @param {object} behaviorConfig - The behavior role configuration
 * @returns {object} Success status
 */
function updateRoleConfig(gameCode, playerId, roleConfig, behaviorConfig) {
  if (!gameCode || !playerId) {
    return { success: false, error: 'Game code and player ID are required' };
  }
  
  gameCode = gameCode.toUpperCase().trim();
  
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const gamesSheet = ss.getSheetByName(GAMES_SHEET);
  
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
    return { success: false, error: 'Only the host can update role configuration' };
  }
  
  // Update role config (Column F) and behavior config (Column G)
  const configData = {
    roleConfig: roleConfig,
    behaviorConfig: behaviorConfig
  };
  gamesSheet.getRange(gameRow, 6).setValue(JSON.stringify(configData));
  
  return {
    success: true,
    roleConfig: roleConfig,
    behaviorConfig: behaviorConfig
  };
}

/**
 * Get role configuration
 * @param {string} gameCode - The game code
 * @returns {object} Role configuration
 */
function getRoleConfig(gameCode) {
  if (!gameCode) {
    return { success: false, error: 'Game code is required' };
  }
  
  gameCode = gameCode.toUpperCase().trim();
  
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const gamesSheet = ss.getSheetByName(GAMES_SHEET);
  
  const gamesData = gamesSheet.getDataRange().getValues();
  
  for (let i = 1; i < gamesData.length; i++) {
    if (gamesData[i][0] === gameCode) {
      try {
        const roleConfig = JSON.parse(gamesData[i][5] || '{}');
        return {
          success: true,
          roleConfig: roleConfig
        };
      } catch (e) {
        return {
          success: true,
          roleConfig: { mode: 'random', count: 6, roles: ROLES }
        };
      }
    }
  }
  
  return { success: false, error: 'Game not found' };
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
  
  // Verify requester is host and get role config
  const gamesData = gamesSheet.getDataRange().getValues();
  let gameRow = -1;
  let hostId = '';
  let configData = { 
    roleConfig: { mode: 'random', count: 6, roles: ROLES },
    behaviorConfig: { mode: 'random', count: 19, behaviors: BEHAVIORS }
  };
  
  for (let i = 1; i < gamesData.length; i++) {
    if (gamesData[i][0] === gameCode) {
      gameRow = i + 1;
      hostId = gamesData[i][1];
      try {
        configData = JSON.parse(gamesData[i][5] || '{}');
      } catch (e) {}
      break;
    }
  }
  
  const roleConfig = configData.roleConfig || { mode: 'random', count: 6, roles: ROLES };
  const behaviorConfig = configData.behaviorConfig || { mode: 'random', count: 19, behaviors: BEHAVIORS };
  
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
  
  // Determine which POWER roles to use
  let rolesToDeal = [];
  if (roleConfig.mode === 'specific' && roleConfig.roles && roleConfig.roles.length > 0) {
    rolesToDeal = [...roleConfig.roles];
  } else if (roleConfig.mode === 'count' && roleConfig.count !== undefined) {
    const shuffledAllRoles = shuffleArray([...ROLES]);
    rolesToDeal = shuffledAllRoles.slice(0, Math.min(roleConfig.count, ROLES.length));
  } else {
    rolesToDeal = [...ROLES];
  }
  
  // Determine which BEHAVIOR roles to use
  let behaviorsToAssign = [];
  if (behaviorConfig.mode === 'specific' && behaviorConfig.behaviors && behaviorConfig.behaviors.length > 0) {
    behaviorsToAssign = [...behaviorConfig.behaviors];
  } else if (behaviorConfig.mode === 'count' && behaviorConfig.count !== undefined) {
    if (behaviorConfig.count === 0) {
      behaviorsToAssign = [];
    } else {
      const shuffledAllBehaviors = shuffleArray([...BEHAVIORS]);
      behaviorsToAssign = shuffledAllBehaviors.slice(0, Math.min(behaviorConfig.count, BEHAVIORS.length));
    }
  } else {
    behaviorsToAssign = [...BEHAVIORS];
  }
  
  // Shuffle both sets
  const shuffledRoles = shuffleArray(rolesToDeal);
  const shuffledBehaviors = shuffleArray(behaviorsToAssign);
  
  // Assign power roles OR behavior roles (not both!)
  // Players with power roles don't get behavior roles
  // Players without power roles get behavior roles instead
  let behaviorIndex = 0;
  for (let i = 0; i < playerRows.length; i++) {
    if (i < shuffledRoles.length) {
      // This player gets a power role, no behavior
      playersSheet.getRange(playerRows[i].row, 5).setValue(shuffledRoles[i]); // Column E = power role
      playersSheet.getRange(playerRows[i].row, 8).setValue('no_behavior');    // Column H = no behavior
    } else {
      // This player gets no power role, assign behavior instead
      const behavior = behaviorIndex < shuffledBehaviors.length ? shuffledBehaviors[behaviorIndex] : 'no_behavior';
      playersSheet.getRange(playerRows[i].row, 5).setValue('no_role');        // Column E = no power role
      playersSheet.getRange(playerRows[i].row, 8).setValue(behavior);         // Column H = behavior role
      behaviorIndex++;
    }
  }
  
  // Update game status
  const timestamp = new Date().toISOString();
  gamesSheet.getRange(gameRow, 3).setValue('dealt');
  gamesSheet.getRange(gameRow, 5).setValue(timestamp);
  
  return {
    success: true,
    message: 'Roles dealt successfully',
    playerCount: playerRows.length,
    rolesDealt: Math.min(shuffledRoles.length, playerRows.length),
    noRoleCount: Math.max(0, playerRows.length - shuffledRoles.length)
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
      const role = playersData[i][4];       // Column E = power role
      const behavior = playersData[i][7];   // Column H = behavior role
      
      if (!role) {
        return { success: false, error: 'Roles have not been dealt yet' };
      }
      
      // Mark as revealed
      playersSheet.getRange(i + 1, 6).setValue(true);
      
      return {
        success: true,
        role: role,
        behavior: behavior || 'no_behavior'
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
 * Ensure required sheets exist (with roleConfig column)
 */
function ensureSheetsExist(ss) {
  let gamesSheet = ss.getSheetByName(GAMES_SHEET);
  if (!gamesSheet) {
    gamesSheet = ss.insertSheet(GAMES_SHEET);
    gamesSheet.appendRow(['gameCode', 'hostId', 'status', 'createdAt', 'rolesDealtAt', 'configData']);
  }
  
  let playersSheet = ss.getSheetByName(PLAYERS_SHEET);
  if (!playersSheet) {
    playersSheet = ss.insertSheet(PLAYERS_SHEET);
    playersSheet.appendRow(['gameCode', 'playerId', 'playerName', 'isHost', 'role', 'revealed', 'joinedAt', 'behavior']);
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
  Logger.log('Available roles: ' + ROLES.join(', '));
}
