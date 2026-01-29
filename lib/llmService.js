const OpenAI = require('openai');

// Initialize OpenAI client if API key is available
let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
}

// Predefined rewriting styles
const REWRITE_STYLES = {
  professional: 'Rewrite the following text in a more professional and formal business tone.',
  casual: 'Rewrite the following text in a casual, friendly, and conversational tone.',
  concise: 'Make the following text more concise and to the point while keeping the core message.',
  elaborate: 'Expand and elaborate on the following text with more details and examples.',
  persuasive: 'Rewrite the following text to be more persuasive and compelling.',
  creative: 'Rewrite the following text in a more creative and engaging way.',
  simple: 'Simplify the following text to make it easier to understand for a general audience.',
  academic: 'Rewrite the following text in an academic and scholarly tone.',
  marketing: 'Rewrite the following text as compelling marketing copy.',
  technical: 'Rewrite the following text in a precise technical style.'
};

/**
 * Rewrite text using an LLM
 * @param {string} text - The original text to rewrite
 * @param {string} prompt - Custom prompt or instruction for rewriting
 * @param {string} style - Predefined style name (optional)
 * @returns {Promise<string>} - The rewritten text
 */
async function rewriteText(text, prompt, style = null) {
  // Build the system prompt
  let systemPrompt = 'You are a helpful writing assistant. Your task is to rewrite text based on the given instructions. Only return the rewritten text, nothing else.';

  // Build the user prompt
  let userPrompt = '';

  if (style && REWRITE_STYLES[style]) {
    userPrompt = `${REWRITE_STYLES[style]}\n\n`;
  }

  if (prompt && prompt.trim()) {
    userPrompt += `Additional instructions: ${prompt}\n\n`;
  }

  userPrompt += `Text to rewrite:\n"${text}"`;

  // If OpenAI is configured, use it
  if (openai) {
    try {
      const response = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 1000
      });

      return response.choices[0]?.message?.content?.trim() || text;
    } catch (error) {
      console.error('OpenAI API error:', error);
      throw new Error('LLM service error: ' + error.message);
    }
  }

  // Fallback: Simple mock transformation for demo purposes
  return mockRewrite(text, prompt, style);
}

/**
 * Mock rewrite function for demo/testing without API key
 */
function mockRewrite(text, prompt, style) {
  // Apply some basic transformations based on style
  let result = text;

  switch (style) {
    case 'professional':
      result = text.charAt(0).toUpperCase() + text.slice(1);
      if (!result.endsWith('.')) result += '.';
      result = result.replace(/!/g, '.');
      break;

    case 'casual':
      result = text.toLowerCase();
      result = result.replace(/\./g, '!');
      break;

    case 'concise':
      // Remove filler words
      const fillers = ['very', 'really', 'just', 'actually', 'basically', 'literally'];
      fillers.forEach(filler => {
        result = result.replace(new RegExp(`\\b${filler}\\b`, 'gi'), '');
      });
      result = result.replace(/\s+/g, ' ').trim();
      break;

    case 'elaborate':
      result = `Indeed, ${text.toLowerCase()} This is an important point worth considering carefully.`;
      break;

    case 'persuasive':
      result = `Here's why this matters: ${text} Don't miss out on this!`;
      break;

    case 'creative':
      result = `✨ ${text} ✨`;
      break;

    case 'simple':
      result = text.replace(/\b\w{10,}\b/g, match => match.substring(0, 6) + '...');
      break;

    default:
      // Apply custom prompt as a prefix if provided
      if (prompt) {
        result = `[${prompt}] ${text}`;
      }
  }

  return Promise.resolve(result);
}

/**
 * Get available rewrite styles
 */
function getAvailableStyles() {
  return Object.keys(REWRITE_STYLES).map(key => ({
    id: key,
    name: key.charAt(0).toUpperCase() + key.slice(1),
    description: REWRITE_STYLES[key]
  }));
}

/**
 * Check if LLM service is properly configured
 */
function isConfigured() {
  return !!openai;
}

module.exports = {
  rewriteText,
  getAvailableStyles,
  isConfigured,
  REWRITE_STYLES
};
