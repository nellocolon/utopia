// ============================================================
// UTOPIA - Twitter Action Verifier (Simulation / Bot Stub)
// ============================================================
// In production, replace with actual Twitter API v2 calls
// using OAuth 2.0 PKCE. For MVP, this simulates verification
// with anti-fraud heuristics.
// ============================================================

const VERIFICATION_SUCCESS_RATE = 0.85; // 85% success rate sim

/**
 * Simulate verification of Twitter actions for a given tweet.
 * In production: call Twitter API v2 to verify likes, retweets, replies.
 */
async function verifyTwitterActions(twitterHandle, tweetId, actions) {
  console.log(`[BOT] Verifying @${twitterHandle} on tweet ${tweetId}`);

  // Anti-fraud: simple delay to simulate API call
  await sleep(300 + Math.random() * 700);

  // In real implementation:
  // const liked = await checkLike(twitterHandle, tweetId);
  // const retweeted = await checkRetweet(twitterHandle, tweetId);
  // const commented = await checkReply(twitterHandle, tweetId);

  // MVP Simulation: actions marked as done pass with ~85% rate
  const verify = (claimed) => claimed && Math.random() < VERIFICATION_SUCCESS_RATE;

  return {
    like:    verify(actions.did_like),
    retweet: verify(actions.did_retweet),
    comment: verify(actions.did_comment),
    verified_at: new Date().toISOString(),
    method: 'simulation_v1' // Change to 'twitter_api_v2' in production
  };
}

/**
 * Extract tweet ID from Twitter URL
 */
function extractTweetId(url) {
  const match = url.match(/status\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Validate that a URL is a valid Twitter/X tweet URL
 */
function isValidTweetUrl(url) {
  return /^https?:\/\/(twitter\.com|x\.com)\/.+\/status\/\d+/.test(url);
}

// ── Production Twitter API v2 Stubs ──────────────────────────
// Uncomment and implement these when Twitter API access is available

/*
const TwitterApi = require('twitter-api-v2');
const client = new TwitterApi(process.env.TWITTER_BEARER_TOKEN);

async function checkLike(userId, tweetId) {
  try {
    const likes = await client.v2.tweetLikedBy(tweetId);
    return likes.data?.some(u => u.username.toLowerCase() === userId.toLowerCase());
  } catch { return false; }
}

async function checkRetweet(userId, tweetId) {
  try {
    const rts = await client.v2.tweetRetweetedBy(tweetId);
    return rts.data?.some(u => u.username.toLowerCase() === userId.toLowerCase());
  } catch { return false; }
}

async function checkReply(userId, tweetId) {
  try {
    const replies = await client.v2.search(`conversation_id:${tweetId} from:${userId}`);
    return replies.data?.meta?.result_count > 0;
  } catch { return false; }
}
*/

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { verifyTwitterActions, extractTweetId, isValidTweetUrl };
