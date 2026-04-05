/**
 * Model Name Normalizer Middleware
 * 
 * DEPRECATED: Model normalization removed.
 * All providers now use their official model names with direct HTTP calls.
 * 
 * This middleware is kept as a placeholder for potential future use cases,
 * but currently does nothing (pass-through).
 */

/**
 * Pass-through middleware (normalization disabled)
 * Models are passed to providers with their original names
 */
function normalizeModelName(req, res, next) {
  // No normalization - pass model name through as-is
  // Providers handle their official model names directly
  return next();
}

module.exports = {
  normalizeModelName
};
