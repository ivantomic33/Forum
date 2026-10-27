import { useEffect } from 'react';

/**
 * Hero parallax — cinematic hover (NEXUS 4.0 „Neon Glass“).
 *
 * Dodaje samo CSS promenljive `--ng-parallax-x` / `--ng-parallax-y` na
 * `.hero-band` i klasu `ng-hero--active` (za `will-change`) dok je hero vidljiv.
 * Nema uticaja na tekst, DOM strukturu, state, API ni rute.
 *
 * - mousemove + requestAnimationFrame (bez biblioteka, jedno čitanje po frame-u)
 * - 6–8 px pomaka za celo trajanje gesta (faktor 8)
 * - isključeno na `prefers-reduced-motion: reduce` i na grubom pokazivaču (touch)
 * - slušaoci se skidaju pri unmount-u; `will-change` se gasi kad hero izađe iz viewporta
 */
export function useHeroParallax() {
  useEffect(() => {
    const hero = document.querySelector<HTMLElement>('.hero-band');
    if (!hero) return;

    const canHover = window.matchMedia('(hover: hover) and (pointer: fine)');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!canHover.matches || reduceMotion.matches) return;

    const MAX_OFFSET = 8;
    let frame = 0;
    let targetX = 0;
    let targetY = 0;
    let lastX = 0;
    let lastY = 0;

    const apply = () => {
      frame = 0;
      lastX += (targetX - lastX) * 0.12;
      lastY += (targetY - lastY) * 0.12;
      hero.style.setProperty('--ng-parallax-x', `${lastX.toFixed(2)}px`);
      hero.style.setProperty('--ng-parallax-y', `${lastY.toFixed(2)}px`);
      if (Math.abs(targetX - lastX) > 0.05 || Math.abs(targetY - lastY) > 0.05) {
        frame = requestAnimationFrame(apply);
      }
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };

    const onMove = (event: MouseEvent) => {
      const rect = hero.getBoundingClientRect();
      // -1 … 1 relativno na centar hero-a, pa skalirano na ±8 px
      targetX = ((event.clientX - rect.left) / rect.width - 0.5) * -MAX_OFFSET;
      targetY = ((event.clientY - rect.top) / rect.height - 0.5) * -MAX_OFFSET;
      schedule();
    };

    const onLeave = () => {
      targetX = 0;
      targetY = 0;
      schedule();
    };

    const onMotionChange = () => {
      if (reduceMotion.matches) {
        hero.style.removeProperty('--ng-parallax-x');
        hero.style.removeProperty('--ng-parallax-y');
      }
    };

    // `will-change` samo dok je hero vidljiv — nema trajnog GPU sloja.
    const observer = new IntersectionObserver(
      ([entry]) => hero.classList.toggle('ng-hero--active', entry.isIntersecting),
      { rootMargin: '120px' },
    );
    observer.observe(hero);

    hero.addEventListener('mousemove', onMove, { passive: true });
    hero.addEventListener('mouseleave', onLeave, { passive: true });
    reduceMotion.addEventListener('change', onMotionChange);

    return () => {
      observer.disconnect();
      hero.removeEventListener('mousemove', onMove);
      hero.removeEventListener('mouseleave', onLeave);
      reduceMotion.removeEventListener('change', onMotionChange);
      hero.classList.remove('ng-hero--active');
      hero.style.removeProperty('--ng-parallax-x');
      hero.style.removeProperty('--ng-parallax-y');
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
}
