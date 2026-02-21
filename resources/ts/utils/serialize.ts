export interface SerializeOptions {
  maxDepth?: number;
  maxSize?: number;
  skipPrefixes?: string[];
}

const DEFAULT_MAX_DEPTH = 10;
const DEFAULT_MAX_SIZE = 10240;
const DEFAULT_SKIP_PREFIXES = ['$', '_x', '__'];

export function safeSerialize(
  value: unknown,
  options: SerializeOptions = {},
  seen = new WeakSet<object>(),
  depth = 0
): unknown {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const skipPrefixes = options.skipPrefixes ?? DEFAULT_SKIP_PREFIXES;

  if (depth > maxDepth) return { __type: 'max_depth' };
  if (value === null) return null;
  if (value === undefined) return undefined;

  if (typeof value !== 'object' && typeof value !== 'function') {
    return value;
  }

  if (typeof value === 'function') {
    return { __type: 'function', name: (value as { name?: string }).name || 'anonymous' };
  }

  if (value instanceof HTMLElement) {
    return {
      __type: 'HTMLElement',
      tag: value.tagName.toLowerCase(),
      id: value.id || null,
      classes: value.className || null,
    };
  }

  if (value instanceof Error) {
    return { __type: 'Error', name: value.name, message: value.message, stack: value.stack };
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (seen.has(value as object)) {
    return { __type: 'circular' };
  }
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((v) => safeSerialize(v, options, seen, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (skipPrefixes.some((prefix) => k.startsWith(prefix))) {
      continue;
    }
    result[k] = safeSerialize(v, options, seen, depth + 1);
  }
  return result;
}

export function serializeForTransport(value: unknown, maxSize = DEFAULT_MAX_SIZE): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;

  try {
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (value instanceof Error) {
      return { __type: 'Error', name: value.name, message: value.message };
    }
    if (value instanceof HTMLElement) {
      return { __type: 'HTMLElement', tag: value.tagName.toLowerCase(), id: value.id, classes: value.className };
    }

    const json = JSON.stringify(value);
    if (json.length > maxSize) {
      if (Array.isArray(value)) {
        return { _truncated: true, _size: json.length, _type: 'array', _length: value.length };
      }
      if (typeof value === 'object') {
        return { _truncated: true, _size: json.length, _type: 'object' };
      }
      return json.substring(0, maxSize) + '... [truncated]';
    }

    return value;
  } catch (e) {
    return `[serialization error: ${(e as Error).message}]`;
  }
}
