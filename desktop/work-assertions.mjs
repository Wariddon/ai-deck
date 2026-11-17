const own = (value, key) => value !== null && typeof value === 'object' && Object.hasOwn(value, key);
const scalar = value => typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && value.length <= 200;

// Bounded data predicates, never code, shell commands or model-generated verdicts.
export function normalizeEvidenceAssertions(input, paths) {
  if (!Array.isArray(input) || input.length > 8) throw Error('Use up to eight observable assertions per evidence reference.');
  return input.map(value => {
    if (!value || !paths.includes(value.path) || typeof value.pointer !== 'string' || value.pointer.length > 200 ||
        value.pointer !== '' && !value.pointer.startsWith('/') || /[\u0000-\u001f]|~(?![01])/u.test(value.pointer) ||
        value.pointer.split('/').length > 13 || !['equals', 'atMost', 'atLeast'].includes(value.operator) || !scalar(value.value) ||
        value.operator !== 'equals' && typeof value.value !== 'number') throw Error('Give each assertion a referenced JSON file, a bounded JSON pointer and a scalar comparison.');
    return { path: value.path, pointer: value.pointer, operator: value.operator, value: value.value };
  });
}

export function evaluateEvidenceAssertions(assertions, documents, verified) {
  return assertions.map(assertion => {
    const { path, pointer, operator, value: expected } = assertion;
    const result = { path, pointer, operator, expected, status: 'unverified' };
    const document = documents.get(path);
    if (!verified || !document || document.error) return result;
    let actual = document.value;
    for (const token of pointer === '' ? [] : pointer.slice(1).split('/')) {
      const key = token.replaceAll('~1', '/').replaceAll('~0', '~');
      if (!own(actual, key) || Array.isArray(actual) && !/^(?:0|[1-9]\d*)$/u.test(key)) return { ...result, status: 'failed', reason: 'The expected JSON value is missing.' };
      actual = actual[key];
    }
    if (!scalar(actual) || typeof actual !== typeof expected) return { ...result, status: 'failed', reason: 'The observed value has a different type or is not a bounded scalar.' };
    const passed = operator === 'equals' ? actual === expected : operator === 'atMost' ? actual <= expected : actual >= expected;
    return { ...result, actual, status: passed ? 'passed' : 'failed' };
  });
}
