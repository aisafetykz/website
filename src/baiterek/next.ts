// The page's side of the forward pass: the last word of the statement (see
// NextToken.astro) waits for the tower to say it. The tower reports how far
// its pass on the statement has got, and the statement's tokens and the
// candidates for the next one follow.

export type Predicting = { layer: number; layers: number };

export function predict(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>("[data-next]").forEach((slot) => {
    const candidates: [token: string, before: number, after: number][] = JSON.parse(slot.dataset.candidates!);
    const rows = [...slot.querySelectorAll<HTMLElement>(".row")];
    const chance = slot.querySelector(".chance")!;

    // The probabilities `t` of the way through the layers, and each row at
    // its rank.
    const show = (t: number) => {
      const weights = candidates.map(([, before, after]) => before ** (1 - t) * after ** t);
      const total = weights.reduce((sum, weight) => sum + weight);
      const ranked = weights.map((_, i) => i).sort((a, b) => weights[b] - weights[a]);
      rows.forEach((row, i) => {
        const p = weights[i] / total;
        row.style.setProperty("--rank", String(ranked.indexOf(i)));
        row.style.setProperty("--p", p.toFixed(3));
        row.classList.toggle("top", ranked[0] === i);
        row.querySelector(".p")!.textContent = p.toFixed(2);
        if (i === 0) chance.textContent = `p=${p.toFixed(2)}`;
      });
    };

    // Before the pass (layer -1) there is only the cursor. From the prompt
    // (0) up through the layers the prompt is in tokens and the candidates
    // show, and past the last layer the word is said.
    root.addEventListener("baiterek:predict", (e) => {
      const { layer, layers } = (e as CustomEvent<Predicting>).detail;
      show(Math.max(0, Math.min(1, layer / layers)));
      slot.classList.toggle("waiting", layer <= layers);
      slot.classList.toggle("predicting", layer >= 0 && layer <= layers);
      slot.classList.toggle("said", layer > layers);
    });
  });
}
