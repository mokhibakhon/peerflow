#!/usr/bin/env node
/*
 * Run:  node dev/404-field.js
 *
 * Prints the markup to stdout; paste it inside the .g404 container. Nothing
 * calls this at request time and nothing in CI runs it — it exists so the
 * field can be regenerated when the mark changes or the digits do, rather than
 * being a block of 207 elements nobody can reproduce.
 *
 * Generates the "404" field as static markup, so the page needs no JavaScript
 * to draw its own graphic and nothing moves after first paint. Seeded, so
 * re-running produces the same field rather than a new one on every commit.
 *
 * Two attempts came before this one and both failed the same way. The first
 * used a 5x7 font with one-cell strokes: at one cell wide a stroke cannot be
 * told from the noise around it. The second went to 7x9 with two-cell strokes
 * but filled the cells with code punctuation — { } < > / ( ) [ ] = + * — and
 * the number still would not read, because those glyphs have wildly different
 * ink: a '.' next to a '{' makes every cell a different weight and the eye
 * never joins them into a bar. TryHackMe's reads because 0 and 1 are one
 * width, one height, no ascenders, no descenders.
 *
 * So the cells hold no text at all. Each one is the PeerFlow mark, painted as
 * a CSS mask over the cell's own colour: one dense square shape, identical in
 * every cell, and the number comes out of the site's own logo repeated rather
 * than out of an alphabet borrowed from somebody else's subject. It is also
 * far less markup — a cell is a class and nothing else — and it recolours by
 * changing a CSS custom property rather than by regenerating anything. */
const FONT = {
  '4': ['0000110','0001110','0011110','0110110','1100110','1111111','1111111','0000110','0000110'],
  '0': ['0111110','1111111','1100011','1100011','1100011','1100011','1100011','1111111','0111110'],
};
const WORD = ['4', '0', '4'];

/* mulberry32 — a seeded PRNG in six lines. */
let s = 0x9E3779B9;
const rnd = () => {
  s |= 0; s = (s + 0x6D2B79F5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const rows = 9;
const cols = WORD.length * 7 + (WORD.length - 1);
const on = [];
for (let r = 0; r < rows; r++) {
  on[r] = new Array(cols).fill(0);
  let x = 0;
  for (const ch of WORD) {
    for (let c = 0; c < 7; c++) on[r][x + c] = FONT[ch][r][c] === '1' ? 1 : 0;
    x += 8;
  }
}


const out = [];
for (let r = 0; r < rows; r++) {
  const line = [];
  for (let c = 0; c < cols; c++) {
    if (on[r][c]) {
      /* Weighted towards the one bright step. Three greens at equal weight is
         three brightnesses fighting, and the stroke stops being a stroke. */
      const v = rnd();
      line.push('<i class="' + (v < 0.14 ? 'a' : v < 0.74 ? 'b' : 'c') + '"></i>');
    } else if (rnd() < 0.055) {
      line.push('<i class="d"></i>');
    } else {
      line.push('<i></i>');
    }
  }
  out.push(line.join(''));
}
console.log(out.join('\n'));
