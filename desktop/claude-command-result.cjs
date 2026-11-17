// Consume the native foreground Bash result, never the model's prose or an
// exit-code-looking line in command output. Some CLI versions omit numeric exit.
function claudeCommandResult(message, item, foreground) {
  if (!foreground) return {};
  const result = message.tool_use_result ?? message.toolUseResult;
  if (result?.backgroundTaskId || result?.background_task_id || result?.task_id) return {};
  const source = { completionSource: 'claude-tool-result' };
  if (result?.interrupted === true) return { ...source, completion: 'interrupted' };
  const code = result?.exitCode ?? result?.exit_code;
  if (Number.isSafeInteger(code)) return { ...source, exitCode: code, completion: code === 0 && item.is_error !== true ? 'succeeded' : 'failed' };
  if (item.is_error === true) return { ...source, completion: 'failed' };
  if (item.is_error === false && result?.interrupted === false && typeof result.stdout === 'string' && typeof result.stderr === 'string') {
    return { ...source, completion: 'succeeded' };
  }
  return {};
}

function observedCheckOutcome(check) {
  if (check?.freshness !== 'matched') return 'unverified';
  if (check.completionSource === 'claude-tool-result' && check.completion === 'failed') return 'failed';
  if (check.completionSource === 'claude-tool-result' && check.completion === 'interrupted') return 'unverified';
  if (Number.isSafeInteger(check.exitCode)) return check.exitCode === 0 ? 'passed' : 'failed';
  return check.completionSource === 'claude-tool-result' && check.completion === 'succeeded' ? 'passed' : 'unverified';
}
module.exports = { claudeCommandResult, observedCheckOutcome };
