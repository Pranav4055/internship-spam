function collectSignals(error, signals = { names: [], codes: [], messages: [] }, seen = new Set()) {
  if (!error || (typeof error !== 'object' && typeof error !== 'string') || seen.has(error)) return signals;
  if (typeof error === 'string') {
    signals.messages.push(error);
    return signals;
  }
  seen.add(error);
  if (typeof error.name === 'string') signals.names.push(error.name);
  if (typeof error.code === 'string' || typeof error.code === 'number') signals.codes.push(String(error.code));
  if (typeof error.codeName === 'string') signals.codes.push(error.codeName);
  if (typeof error.message === 'string') signals.messages.push(error.message);

  for (const key of ['cause', 'reason', 'error', 'originalError', 'servers']) {
    const value = error[key];
    if (value instanceof Map) {
      for (const nested of value.values()) collectSignals(nested, signals, seen);
    } else if (Array.isArray(value)) {
      for (const nested of value) collectSignals(nested, signals, seen);
    } else if (value && typeof value === 'object') {
      collectSignals(value, signals, seen);
    }
  }
  return signals;
}

/** Return only a fixed, credential-free diagnosis; never return driver text. */
export function diagnoseMongoError(error, { operation = 'connection' } = {}) {
  const signals = collectSignals(error);
  const searchable = [...signals.codes, ...signals.names, ...signals.messages].join(' ').toLowerCase();
  const normalizedCodes = signals.codes.map((code) => code.toUpperCase());

  if (/(?:ip(?: address)? .{0,160}(?:not allowed|not authorized|not in (?:the )?access list|not whitelisted)|(?:access list|whitelist).{0,160}ip)/i.test(searchable)) {
    return {
      code: 'ATLAS_IP_ACCESS_RESTRICTED',
      message: 'Atlas reports that this client IP is not allowed. Add only your current public IP to the project IP access list, then retry.',
    };
  }
  if (signals.codes.some((code) => ['18', '8000', 'AUTHENTICATIONFAILED'].includes(code.toUpperCase()))
      || /authentication failed|bad auth|auth failed/i.test(searchable)) {
    return {
      code: 'AUTHENTICATION_FAILED',
      message: 'MongoDB rejected the database credentials. Check the Atlas database username, password, and authentication settings.',
    };
  }
  if (signals.codes.some((code) => code.toUpperCase() === 'ECONNREFUSED') && /querysrv|srv lookup|resolve srv/i.test(searchable)) {
    return {
      code: 'DNS_RESOLVER_REFUSED',
      message: 'The DNS resolver refused the Atlas SRV lookup. Check the current network, VPN, firewall, or DNS resolver; allow DNS queries to the configured resolver.',
    };
  }
  if (normalizedCodes.includes('ERR_INVALID_URL')
      || signals.names.some((name) => /MongoParseError/i.test(name))
      || /invalid (?:mongodb )?(?:connection string|url)|unable to parse .{0,160} with url|must start with .{0,100}mongodb/i.test(searchable)) {
    return {
      code: 'INVALID_CONNECTION_STRING',
      message: 'The MongoDB connection string or one of its host values is malformed. Copy the Atlas driver URI and replace all placeholders with the exact values Atlas provides; do not add angle brackets around hosts.',
    };
  }
  if (normalizedCodes.some((code) => ['13', 'UNAUTHORIZED'].includes(code))
      || /not authorized on|authorization failed|unauthorized/i.test(searchable)) {
    return {
      code: 'DATABASE_PERMISSION_DENIED',
      message: operation === 'seed'
        ? 'MongoDB connected, but this database user cannot write detection rules. Grant the required access on the InternShield database.'
        : 'MongoDB rejected an operation because the runtime database user lacks permission. Grant only the required read access on the InternShield database.',
    };
  }
  if (normalizedCodes.some((code) => ['93', '103', 'INVALIDREPLICASETCONFIG', 'NEWREPLICASETCONFIGURATIONINCOMPATIBLE'].includes(code))
      || /replica.?set.{0,120}(?:configuration|config|mismatch|not a replica|not a member|invalid)|(?:configuration|config|mismatch).{0,120}replica.?set/i.test(searchable)) {
    return {
      code: 'REPLICA_SET_CONFIGURATION_ERROR',
      message: 'MongoDB rejected the replica-set configuration. Compare the URI and replica-set options with the Atlas driver connection string; do not add or change a replica-set name by guesswork.',
    };
  }
  if (signals.codes.some((code) => ['ENOTFOUND', 'EAI_AGAIN', 'ESERVFAIL', 'ENODATA'].includes(code.toUpperCase()))
      || /querysrv|dns lookup|enotfound|eai_again|eservfail|enodata/i.test(searchable)) {
    return {
      code: 'DNS_LOOKUP_FAILED',
      message: 'The MongoDB hostname could not be resolved. Check the Atlas cluster hostname and local DNS/network access.',
    };
  }
  if (signals.codes.some((code) => ['ETIMEDOUT', 'ETIMEOUT'].includes(code.toUpperCase()))
      || /server selection timed out|timed out|timeout/i.test(searchable)) {
    return {
      code: 'CONNECTION_TIMEOUT',
      message: 'MongoDB connection timed out. Check outbound network access and the Atlas IP access list; Atlas may time out when a client IP is not allowed.',
    };
  }
  if (signals.codes.some((code) => ['ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH'].includes(code.toUpperCase()))
      || /network error|connection refused|connection reset|network unreachable|host unreachable/i.test(searchable)) {
    return {
      code: 'NETWORK_ERROR',
      message: 'The network connection to MongoDB failed. Check outbound connectivity, firewall rules, and Atlas availability.',
    };
  }
  return {
    code: operation === 'seed' ? 'RULE_SEED_FAILED' : 'CONNECTION_FAILED',
    message: operation === 'seed'
      ? 'MongoDB connected, but the detection rules could not be written. Check database permissions and rule schema compatibility.'
      : 'MongoDB connection failed for an unclassified reason. Check the connection string format and Atlas cluster status.',
  };
}
