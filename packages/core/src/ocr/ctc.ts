/**
 * CTC greedy decoding: the best class at each step, repeats collapsed, blanks dropped.
 * `probs` is T × C (already softmax). Class k > blank is `dictionary[k − 1]`. Confidence is
 * the mean probability of the characters kept.
 */
export function ctcDecode(
  probs: Float32Array,
  steps: number,
  classes: number,
  dictionary: readonly string[],
  blank = 0,
): { text: string; confidence: number } {
  let text = '';
  let sum = 0;
  let n = 0;
  let prev = -1;
  for (let t = 0; t < steps; t++) {
    const row = t * classes;
    let best = 0;
    let p = probs[row]!;
    for (let c = 1; c < classes; c++) {
      const v = probs[row + c]!;
      if (v > p) {
        p = v;
        best = c;
      }
    }
    if (best !== blank && best !== prev) {
      text += dictionary[best - 1] ?? '';
      sum += p;
      n++;
    }
    prev = best;
  }
  return { text, confidence: n ? sum / n : 0 };
}
