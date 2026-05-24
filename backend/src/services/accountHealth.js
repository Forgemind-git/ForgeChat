// Centralised health-state writer for whatsapp_accounts. Called from the send
// queue worker (on Meta API failures) and from templates.submit. Lets the UI
// show a "Token expired, update now" banner instead of letting failures pile
// up silently.

const pool = require('../db');

/**
 * Classify an error from Meta and persist it on the account row.
 * @param {number|string} accountId
 * @param {'healthy'|'invalid_token'|'rate_limited'|'unknown_error'} status
 * @param {string} [message]
 */
async function markAccountHealth(accountId, status, message = null) {
  if (!accountId) return;
  try {
    if (status === 'healthy') {
      await pool.query(
        `UPDATE coexistence.whatsapp_accounts
            SET health_status = 'healthy',
                last_success_at = NOW(),
                last_error_message = NULL
          WHERE id = $1`,
        [accountId]
      );
    } else {
      await pool.query(
        `UPDATE coexistence.whatsapp_accounts
            SET health_status = $1,
                last_error_at = NOW(),
                last_error_message = $2
          WHERE id = $3`,
        [status, (message || '').slice(0, 500), accountId]
      );
    }
  } catch (err) {
    console.error('[accountHealth] update failed:', err.message);
  }
}

/**
 * Classify a thrown error from metaSend/metaTemplates into a health status.
 */
function classifyMetaError(err) {
  if (!err) return 'unknown_error';
  if (err.status === 401 || err.metaError?.code === 190) return 'invalid_token';
  if (err.status === 429 || err.metaError?.code === 4 || err.metaError?.code === 80007) return 'rate_limited';
  return 'unknown_error';
}

module.exports = { markAccountHealth, classifyMetaError };
