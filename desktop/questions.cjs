function readQuestions(items, provider) {
  const claude = provider === "claude";
  if (!Array.isArray(items) || !items.length || items.length > (claude ? 4 : 3)) return null;
  const questions = [];
  const ids = new Set();
  for (const item of items) {
    const id = claude ? item?.question : item?.id;
    if (typeof id !== "string" || !id.trim() || id.length > 3000 || ids.has(id)) return null;
    if (typeof item.question !== "string" || !item.question.trim() || item.question.length > 3000) return null;
    const options = Array.isArray(item.options) ? item.options : [];
    if (options.length > 8 || options.some((option) =>
      typeof option?.label !== "string" || !option.label.trim() || option.label.length > 400)) return null;
    ids.add(id);
    questions.push({
      id, text: item.question, header: typeof item.header === "string" ? item.header.slice(0, 100) : "",
      options: options.map(({ label, description }) => ({ label, description: typeof description === "string" ? description.slice(0, 1200) : "" })),
      multi: claude && item.multiSelect === true,
      free: claude || item.isOther === true || options.length === 0,
      secret: !claude && item.isSecret === true,
    });
  }
  return questions;
}

function validateAnswers(questions, answers) {
  if (!Array.isArray(answers) || answers.length !== questions.length) throw new Error("Answer each question or skip the request.");
  return questions.map((question, index) => {
    const response = answers[index];
    if (!Array.isArray(response) || !response.length || response.length > (question.multi ? question.options.length + 1 : 1) ||
      response.some((value) => typeof value !== "string" || !value.trim() || value.length > 3000 ||
        (!question.free && !question.options.some(({ label }) => label === value)))) {
      throw new Error("Choose a valid answer for each question.");
    }
    return [...new Set(response)];
  });
}

module.exports = { readQuestions, validateAnswers };
