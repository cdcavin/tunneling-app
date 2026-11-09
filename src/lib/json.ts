/** Parse JSON written by Python, which spells missing values as bare NaN / Infinity. */
export async function readJson<T>(r: Response): Promise<T> {
  const text = await r.text();
  return JSON.parse(text.replace(/(?<=[:\[,]\s*)(?:NaN|-?Infinity)(?=\s*[,}\]])/g, "null")) as T;
}
