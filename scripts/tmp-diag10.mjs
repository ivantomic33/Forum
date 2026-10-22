export default async function run(page, ui) {
  await page.waitForSelector('.forum-cat-icon svg');
  const info = await page.evaluate(() => {
    const card = document.querySelector('.forum-cat-card');
    const iconSvg = card.querySelector('.forum-cat-icon svg');
    const chevron = card.querySelector('svg.forum-cat-arrow');
    const navSearch = document.querySelector('nav svg.lucide-search');

    const probe = (el) => {
      const r = el.getBoundingClientRect();
      const stack = document.elementsFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return {
        box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        visibleInViewport: r.y >= 0 && r.y < window.innerHeight,
        top: stack.slice(0, 4).map((e) => e.tagName.toLowerCase() + '.' + String(e.getAttribute('class') || '').slice(0, 30)),
      };
    };

    // Walk up the card's ancestors looking for anything with clipping/filtering.
    const flagged = [];
    for (let el = card; el && el !== document.documentElement; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (
        cs.opacity !== '1' ||
        cs.filter !== 'none' ||
        cs.backdropFilter !== 'none' ||
        cs.clipPath !== 'none' ||
        cs.mask !== 'none' ||
        cs.transform !== 'none' ||
        cs.contain !== 'none'
      ) {
        flagged.push(
          el.tagName.toLowerCase() +
          '#' +
          String(cur(el)) +
          ` opacity=${cs.opacity} filter=${cs.filter} backdrop=${cs.backdropFilter} clip=${cs.clipPath} transform=${cs.transform} contain=${cs.contain}`,
        );
      }
    }
    function cur(el) {
      return String(el.getAttribute?.('class') || '').slice(0, 28);
    }

    return {
      icon: probe(iconSvg),
      chevron: probe(chevron),
      navSearch: probe(navSearch),
      flaggedAncestors: flagged,
      cardAnimations: getComputedStyle(card).animation,
      bodyAnimations: getComputedStyle(document.body).animation,
    };
  });
  process.stdout.write('OVER ' + JSON.stringify(info, null, 1) + '\n');
  return 'done';
}
