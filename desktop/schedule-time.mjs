export function nextOccurrence(schedule, after = Date.now()) {
  const [hour, minute] = schedule.time.split(":").map(Number);
  const date = new Date(after);
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset, hour, minute);
    const day = candidate.getDay();
    if (candidate.getTime() <= after) continue;
    if (schedule.cadence === "weekdays" && (day === 0 || day === 6)) continue;
    if (schedule.cadence === "weekly" && day !== schedule.day) continue;
    return candidate.getTime();
  }
  throw new Error("Could not calculate the next scheduled run.");
}