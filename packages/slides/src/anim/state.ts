export type AnimState = {
  opacity: number;
  scale: number;
  dx: number;
  dy: number;
  rotation: number;
  hidden: boolean;
};

export const IDENTITY: AnimState = {
  opacity: 1,
  scale: 1,
  dx: 0,
  dy: 0,
  rotation: 0,
  hidden: false,
};

export function composeAnimStates(states: AnimState[]): AnimState {
  return states.reduce(
    (acc, s) => ({
      opacity: acc.opacity * s.opacity,
      scale: acc.scale * s.scale,
      dx: acc.dx + s.dx,
      dy: acc.dy + s.dy,
      rotation: acc.rotation + s.rotation,
      hidden: acc.hidden || s.hidden,
    }),
    { ...IDENTITY },
  );
}
