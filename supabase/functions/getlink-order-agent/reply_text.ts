export function normalizeReplyText(value:unknown):string{
  return String(value??"")
    .replace(/\r\n?/g,"\n")
    .split("\n")
    .map(line=>line.replace(/[\t\f\v ]+/g," ").trim())
    .join("\n")
    .replace(/\n{3,}/g,"\n\n")
    .trim();
}
