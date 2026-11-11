const fs = require("node:fs");

// Electron installs its binary lazily on first require. Finish that one-time
// download before parallel test workers can require Electron independently.
const executable = require("electron");
if (typeof executable !== "string" || !fs.statSync(executable, { throwIfNoEntry: false })?.isFile()) {
  throw new Error("The Electron runtime is unavailable. Check the download and run npm start or npm test again.");
}
console.log("Electron runtime ready.");
