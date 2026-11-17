// Normalize only the known noninteractive wrapper; never execute or split shell text.
function testCommandText(command) {
  return /^(?:"[^"]*[\\/](?:pwsh|powershell)(?:\.exe)?"|(?:pwsh|powershell)(?:\.exe)?)(?:\s+-(?:NoLogo|NoProfile|NonInteractive))*\s+-Command\s+(['"])(.*)\1$/iu
    .exec(command ?? '')?.[2] ?? command;
}

function standaloneCheck(command) {
  const text = testCommandText(command);
  return typeof text === 'string' && Boolean(text.trim()) && text.length < 2000 &&
    !/[;&|`<>\r\n]|\$\(|\b(?:nohup|start-process|start-job)\b/iu.test(text);
}

module.exports = { testCommandText, standaloneCheck };
