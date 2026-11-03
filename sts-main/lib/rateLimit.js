'use strict';
// Token bucket per event type. One bucket per kind means a burst of sign captions
// can never cause speech captions (or chat) to be dropped.

const DEFAULT_RULES = {
  auth:   { burst: 5,   perSec: 0.1 },
  room:   { burst: 6,   perSec: 0.5 },
  signal: { burst: 300, perSec: 150 }, // ICE candidates arrive in bursts
  media:  { burst: 10,  perSec: 2 },
  chat:   { burst: 8,   perSec: 1 },
  say:    { burst: 5,   perSec: 1 },
  speech: { burst: 12,  perSec: 4 },
  sign:   { burst: 4,   perSec: 0.5 },
};

function createLimiter(rules = DEFAULT_RULES, now = Date.now) {
  const buckets = {};
  return function allow(kind) {
    const rule = rules[kind];
    if (!rule) return true;
    const t = now();
    const b = (buckets[kind] ||= { tokens: rule.burst, t });
    b.tokens = Math.min(rule.burst, b.tokens + ((t - b.t) / 1000) * rule.perSec);
    b.t = t;
    if (b.tokens >= 1) { b.tokens -= 1; return true; }
    return false;
  };
}

module.exports = { DEFAULT_RULES, createLimiter };
