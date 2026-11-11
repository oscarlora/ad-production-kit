// The masonry grid of Studio's Board and Media and of the review link's page (share/, which copies this file in at
// deploy), so plain JS. Its look: studio/app/gallery.css.

// Columns step down with the screen width: 4 > 3 > 2 > 1.
export const columnsFor = (vw) => (vw < 640 ? 1 : vw < 900 ? 2 : vw < 1200 ? 3 : 4);

// Deal items into n columns, each to the shortest so far, so the order still reads left to right.
// heightOf: an item's height per unit of width (1 / its ratio); CSS sizes the cards.
export function masonry(items, n, heightOf) {
  const cols = Array.from({ length: n }, () => ({ items: [], h: 0 }));
  for (const item of items) {
    const col = cols.reduce((a, b) => (b.h < a.h ? b : a));
    col.items.push(item);
    col.h += heightOf(item);
  }
  return cols.map((c) => c.items);
}
