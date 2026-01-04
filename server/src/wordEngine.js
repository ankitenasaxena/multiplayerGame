// =============================================================================
// WORD SELECTION & SECRECY ENGINE MODULE
// Real-time Multiplayer Drawing Game Backend
// =============================================================================
// Purpose: Generate word options, handle word selection, and mask words
// This module ensures word secrecy - only drawer sees options, word never leaked
// =============================================================================

const gameEngine = require('./gameEngine');

// =============================================================================
// WORD LIST
// =============================================================================

// Default word list for generating options
// Words are categorized by difficulty for better game balance
const WORD_LIST = [
  // Easy words
  'cat', 'dog', 'house', 'tree', 'car', 'sun', 'moon', 'star', 'book', 'pen',
  'chair', 'table', 'door', 'window', 'phone', 'computer', 'keyboard', 'mouse',
  'apple', 'banana', 'orange', 'cake', 'pizza', 'hamburger', 'ice cream',
  'bird', 'fish', 'lion', 'tiger', 'elephant', 'giraffe', 'monkey', 'bear',
  'flower', 'grass', 'mountain', 'ocean', 'river', 'beach', 'cloud', 'rain',
  'bicycle', 'airplane', 'train', 'boat', 'bus', 'motorcycle', 'truck',
  'hat', 'shoes', 'shirt', 'pants', 'dress', 'jacket', 'glasses', 'watch',
  
  // Medium words
  'camera', 'guitar', 'piano', 'violin', 'drum', 'microphone', 'speaker',
  'lighthouse', 'bridge', 'castle', 'tower', 'pyramid', 'statue', 'fountain',
  'butterfly', 'dragonfly', 'spider', 'bee', 'ant', 'snake', 'turtle', 'frog',
  'cactus', 'bamboo', 'palm tree', 'forest', 'desert', 'island', 'volcano',
  'helicopter', 'submarine', 'rocket', 'satellite', 'telescope', 'microscope',
  'backpack', 'umbrella', 'flashlight', 'compass', 'map', 'globe', 'flag',
  'crown', 'sword', 'shield', 'treasure', 'key', 'lock', 'chain', 'ring',
  
  // Hard words
  'kaleidoscope', 'telescope', 'microscope', 'periscope', 'binoculars',
  'architect', 'engineer', 'scientist', 'astronaut', 'pilot', 'chef', 'artist',
  'skyscraper', 'cathedral', 'monument', 'amphitheater', 'aqueduct', 'colosseum',
  'chameleon', 'peacock', 'flamingo', 'penguin', 'ostrich', 'eagle', 'hawk',
  'tornado', 'hurricane', 'earthquake', 'avalanche', 'tsunami', 'meteor',
  'saxophone', 'trumpet', 'trombone', 'flute', 'clarinet', 'harmonica', 'accordion',
  'knight', 'wizard', 'dragon', 'unicorn', 'phoenix', 'mermaid', 'vampire'
];

// =============================================================================
// CONFIGURATION CONSTANTS
// =============================================================================

const WORD_OPTIONS_COUNT = 3;
const WORD_SELECTION_TIMEOUT = 15000; // 15 seconds to select word

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get word pool combining custom words and default word list
 * @param {Array} customWords - Custom words from room settings
 * @returns {Array} Combined word pool
 */
function getWordPool(customWords) {
  const pool = [...WORD_LIST];
  
  // Add custom words if they exist
  if (Array.isArray(customWords) && customWords.length > 0) {
    // Filter out duplicates
    const customLower = customWords.map(w => w.toLowerCase());
    pool.push(...customLower.filter(w => !pool.includes(w)));
  }
  
  return pool;
}

/**
 * Generate random word options for drawer to choose from
 * @param {Array} wordPool - Pool of available words
 * @param {number} count - Number of options to generate
 * @returns {Array} Array of word options
 */
function generateWordOptions(wordPool, count = WORD_OPTIONS_COUNT) {
  if (!wordPool || wordPool.length === 0) {
    // Fallback to default words if pool is empty
    wordPool = WORD_LIST;
  }
  
  // Ensure we don't request more words than available
  const optionsCount = Math.min(count, wordPool.length);
  
  // Shuffle and pick random words
  const shuffled = [...wordPool].sort(() => Math.random() - 0.5);
  console.log(`[WORD] Shuffled word pool: ${shuffled.slice(0, optionsCount)}`);
  return shuffled.slice(0, optionsCount);
}

/**
 * Mask a word for display to guessers
 * Replaces letters with underscores, preserves spaces
 * @param {string} word - Word to mask
 * @returns {string} Masked word (e.g., "cat" -> "_ _ _")
 */
function maskWord(word) {
  if (!word || typeof word !== 'string') {
    return '';
  }
  
  // Replace each character with underscore, preserve spaces
  return word
    .split('')
    .map(char => char === ' ' ? ' ' : '_')
    .join(' ');
}

/**
 * Generate progressive hint for word
 * Reveals letters progressively: start with one letter, leave 3 blanks, reveal next
 * Pattern: reveal at positions 2, 6, 10... (every 4th position starting from 2)
 * Then positions 3, 7, 11..., then 1, 5, 9..., then 0, 4, 8...
 * @param {string} word - Word to generate hint for
 * @param {number} hintLevel - Current hint level (0 = all masked, higher = more revealed)
 * @returns {string} Hint word with progressively revealed letters
 */
function generateHint(word, hintLevel = 0) {
  if (!word || typeof word !== 'string') {
    return '';
  }
  
  // Remove spaces for hint calculation
  const wordWithoutSpaces = word.replace(/\s/g, '');
  const wordLength = wordWithoutSpaces.length;
  
  if (wordLength === 0) {
    return '';
  }
  
  // Reveal pattern: start with position 2 (3rd letter), then every 4th position
  // Level 1: reveal position 2
  // Level 2: reveal positions 2, 6
  // Level 3: reveal positions 2, 6, 10
  // Level 4: reveal positions 2, 6, 10, 14
  // Level 5: also reveal position 3 (next in sequence)
  // etc.
  
  const revealedPositions = new Set();
  
  if (hintLevel > 0) {
    // Calculate positions to reveal based on hint level
    // Start revealing from position 2, then every 4th position
    let positionsToReveal = [];
    
    // First round: positions 2, 6, 10, 14... (every 4th starting from 2)
    for (let i = 2; i < wordLength; i += 4) {
      positionsToReveal.push(i);
    }
    
    // Second round: positions 3, 7, 11, 15... (every 4th starting from 3)
    for (let i = 3; i < wordLength; i += 4) {
      positionsToReveal.push(i);
    }
    
    // Third round: positions 1, 5, 9, 13... (every 4th starting from 1)
    for (let i = 1; i < wordLength; i += 4) {
      positionsToReveal.push(i);
    }
    
    // Fourth round: positions 0, 4, 8, 12... (every 4th starting from 0)
    for (let i = 0; i < wordLength; i += 4) {
      positionsToReveal.push(i);
    }
    
    // Reveal up to hintLevel positions
    for (let i = 0; i < hintLevel && i < positionsToReveal.length; i++) {
      revealedPositions.add(positionsToReveal[i]);
    }
  }
  
  // Build the hint string with spaces between characters
  let result = '';
  let charIndex = 0;
  
  for (let i = 0; i < word.length; i++) {
    const char = word[i];
    if (char === ' ') {
      result += ' ';
    } else {
      if (revealedPositions.has(charIndex)) {
        result += char;
      } else {
        result += '_';
      }
      charIndex++;
      // Add space between characters for display (except last char)
      if (i < word.length - 1) {
        const nextChar = word[i + 1];
        if (nextChar !== ' ') {
          result += ' ';
        }
      }
    }
    // Handle spaces in original word
    if (char === ' ' && i < word.length - 1) {
      result += ' ';
    }
  }
  
  return result;
}

/**
 * Normalize word for comparison (lowercase, trim)
 * @param {string} word - Word to normalize
 * @returns {string} Normalized word
 */
function normalizeWord(word) {
  if (!word || typeof word !== 'string') {
    return '';
  }
  return word.trim().toLowerCase();
}

// =============================================================================
// WORD SELECTION FUNCTIONS
// =============================================================================

/**
 * Generate word options for current drawer
 * Called when round starts and phase is WORD_SELECT
 * @param {Object} room - Room object with active game
 * @returns {Object} { success: boolean, options: Array|null, error: string|null }
 */
function generateOptionsForDrawer(room) {
  // Validate game state
  const validation = gameEngine.hasActiveGame(room);
  if (!validation.valid) {
    return { success: false, options: null, error: validation.error };
  }
  
  const game = room.game;
  
  // Check if we're in word selection phase
  if (game.phase !== gameEngine.PHASES.WORD_SELECT) {
    return { success: false, options: null, error: 'Not in word selection phase' };
  }
  
  // Get word pool from room settings
  const wordPool = getWordPool(room.settings.customWords);
  
  // Generate options
  const options = generateWordOptions(wordPool, WORD_OPTIONS_COUNT);
  
  console.log(`[WORD] Generated options for drawer: ${room.id} | Drawer: ${game.drawerId} | Options: ${options.length}`);
  
  return { success: true, options: options, error: null };
}

/**
 * Select word for current round
 * Validates selection and updates game state
 * @param {Object} room - Room object with active game
 * @param {string} playerId - Player selecting word (must be drawer)
 * @param {string} selectedWord - Word selected by drawer
 * @returns {Object} { success: boolean, maskedWord: string|null, error: string|null }
 */
function selectWord(room, playerId, selectedWord) {
  // Validate game state
  const validation = gameEngine.hasActiveGame(room);
  if (!validation.valid) {
    return { success: false, maskedWord: null, error: validation.error };
  }
  
  const game = room.game;
  
  // Check if player is the drawer
  if (!gameEngine.isCurrentDrawer(room, playerId)) {
    return { success: false, maskedWord: null, error: 'Only drawer can select word' };
  }
  
  // Check if we're in word selection phase
  if (game.phase !== gameEngine.PHASES.WORD_SELECT) {
    return { success: false, maskedWord: null, error: 'Not in word selection phase' };
  }
  
  // Validate selected word
  const normalized = normalizeWord(selectedWord);
  if (!normalized || normalized.length === 0) {
    return { success: false, maskedWord: null, error: 'Invalid word selection' };
  }
  
  // Store selected word (server-only, never sent to clients)
  game.selectedWord = normalized;
  
  // Generate masked word for guessers
  game.maskedWord = maskWord(normalized);
  
  // Transition to drawing phase
  const phaseResult = gameEngine.transitionPhase(room, gameEngine.PHASES.DRAWING);
  if (!phaseResult.success) {
    return { success: false, maskedWord: null, error: phaseResult.error };
  }
  
  console.log(`[WORD] Word selected: ${room.id} | Round: ${game.currentRound} | Drawer: ${playerId} | Word: ${normalized} | Masked: ${game.maskedWord}`);
  
  return { success: true, maskedWord: game.maskedWord, error: null };
}

/**
 * Auto-select word if drawer doesn't select in time
 * Picks first option from generated options (fallback)
 * @param {Object} room - Room object with active game
 * @returns {Object} { success: boolean, maskedWord: string|null, error: string|null }
 */
function autoSelectWord(room) {
  // Validate game state
  const validation = gameEngine.hasActiveGame(room);
  if (!validation.valid) {
    return { success: false, maskedWord: null, error: validation.error };
  }
  
  const game = room.game;
  
  // Check if we're in word selection phase
  if (game.phase !== gameEngine.PHASES.WORD_SELECT) {
    return { success: false, maskedWord: null, error: 'Not in word selection phase' };
  }
  
  // Generate word pool and pick first option
  const wordPool = getWordPool(room.settings.customWords);
  const options = generateWordOptions(wordPool, WORD_OPTIONS_COUNT);
  
  if (options.length === 0) {
    return { success: false, maskedWord: null, error: 'No words available' };
  }
  
  // Auto-select first option
  const selectedWord = options[0];
  const normalized = normalizeWord(selectedWord);
  
  // Store selected word
  game.selectedWord = normalized;
  game.maskedWord = maskWord(normalized);
  
  // Transition to drawing phase
  const phaseResult = gameEngine.transitionPhase(room, gameEngine.PHASES.DRAWING);
  if (!phaseResult.success) {
    return { success: false, maskedWord: null, error: phaseResult.error };
  }
  
  console.log(`[WORD] Auto-selected word: ${room.id} | Round: ${game.currentRound} | Drawer: ${game.drawerId} | Word: ${normalized}`);
  
  return { success: true, maskedWord: game.maskedWord, error: null };
}

/**
 * Get masked word for guessers (never reveal actual word)
 * @param {Object} room - Room object with active game
 * @returns {string|null} Masked word or null if not set
 */
function getMaskedWord(room) {
  if (!room.game || !room.game.maskedWord) {
    return null;
  }
  return room.game.maskedWord;
}

/**
 * Get selected word (server-only, for validation)
 * @param {Object} room - Room object with active game
 * @returns {string|null} Selected word or null if not set
 */
function getSelectedWord(room) {
  if (!room.game || !room.game.selectedWord) {
    return null;
  }
  return room.game.selectedWord;
}

/**
 * Clear word selection (for round reset)
 * @param {Object} room - Room object with active game
 */
function clearWordSelection(room) {
  if (room.game) {
    room.game.selectedWord = null;
    room.game.maskedWord = null;
  }
}

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  // Word selection
  generateOptionsForDrawer,
  selectWord,
  autoSelectWord,
  
  // Word access (server-only)
  getSelectedWord,
  getMaskedWord,
  clearWordSelection,
  
  // Utilities
  maskWord,
  normalizeWord,
  generateHint,
  
  // Constants
  WORD_SELECTION_TIMEOUT
};

