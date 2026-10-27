import {
  AnimatePresence,
  domAnimation,
  LazyMotion,
  m,
  type HTMLMotionProps,
} from 'framer-motion';
import { useRef, useState, type ReactNode } from 'react';

/*
 * N-06 — `m` + `LazyMotion` sa `domAnimation` bundle-om (layout, gesteri i
 * drag nisu potrebni) umesto punog `motion` runtime-a.
 */

/* ========== VARIJANTE ANIMACIJA ========== */

export const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

export const fadeIn = {
  hidden: { opacity: 0 },
  visible: (i: number = 0) => ({
    opacity: 1,
    transition: { delay: i * 0.06, duration: 0.45 },
  }),
};

export const scaleIn = {
  hidden: { opacity: 0, scale: 0.92 },
  visible: (i: number = 0) => ({
    opacity: 1,
    scale: 1,
    transition: { delay: i * 0.07, duration: 0.4, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

export const staggerContainer = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.08, delayChildren: 0.05 },
  },
};

export const springPop = {
  hidden: { opacity: 0, scale: 0.6 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { type: 'spring' as const, stiffness: 320, damping: 20 },
  },
};

/* ========== WRAPPER KOMPONENTE ========== */

/**
 * LazyMotion + `domAnimation` — `m` komponente rade samo unutar ovog provajdera.
 * `components/motion.tsx` nije na kritičnom putu (leni rute), pa je dodatnih
 * ~15 kB za `domAnimation` prihvatljivo u zamenu za mali `m` runtime.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <LazyMotion features={domAnimation}>{children}</LazyMotion>;
}

/** Staggered container — deca koriste <StaggerItem /> */
export function Stagger({ children, className, ...rest }: { children: ReactNode } & HTMLMotionProps<'div'>) {
  return (
    <m.div
      className={className}
      variants={staggerContainer}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.12 }}
      {...rest}
    >
      {children}
    </m.div>
  );
}

/** Item unutar Stagger containera */
export function StaggerItem({ children, className, ...rest }: { children: ReactNode } & HTMLMotionProps<'div'>) {
  return (
    <m.div className={className} variants={fadeUp} {...rest}>
      {children}
    </m.div>
  );
}

/** Fade-in-up na scroll */
export function Reveal({ children, delay = 0, className, ...rest }: { children: ReactNode; delay?: number } & HTMLMotionProps<'div'>) {
  return (
    <m.div
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.15 }}
      variants={fadeUp}
      custom={delay}
      {...rest}
    >
      {children}
    </m.div>
  );
}

/** Modal / dialog pop animacija */
export function ModalBackdrop({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <m.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClick}
    >
      {children}
    </m.div>
  );
}

export function ModalPanel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <m.div
      className={className ?? 'ui-card-static w-full max-w-md p-6'}
      initial={{ opacity: 0, scale: 0.9, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: 12 }}
      transition={{ type: 'spring', stiffness: 380, damping: 28 }}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </m.div>
  );
}

export { AnimatePresence, LazyMotion, domAnimation, m as motion };

/** 3D tilt kartica — prati kursor i naginje se blago (gaming feel) */
export function TiltCard({ children, className, maxTilt = 8 }: { children: ReactNode; className?: string; maxTilt?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});

  const handleMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    setStyle({
      transform: `perspective(900px) rotateY(${px * maxTilt}deg) rotateX(${-py * maxTilt}deg) translateZ(6px)`,
    });
  };
  const reset = () =>
    setStyle({
      transform: 'perspective(900px) rotateY(0deg) rotateX(0deg) translateZ(0)',
    });

  return (
    <div
      ref={ref}
      className={className}
      style={{ ...style, transition: 'transform 0.18s ease-out, box-shadow 0.3s', transformStyle: 'preserve-3d' }}
      onMouseMove={handleMove}
      onMouseLeave={reset}
    >
      {children}
    </div>
  );
}
