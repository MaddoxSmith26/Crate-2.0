/**
 * Design tokens. Crate is dark and quiet so album covers carry the color:
 * warm near-black like the inside of a record shop, cream text like an inner
 * sleeve, and one amber accent like a price-sticker dot.
 */
export const colors = {
  background: '#14110F',
  surface: '#1E1A17',
  surfaceRaised: '#2A2420',
  border: '#3A322C',
  text: '#F3EBDD',
  textMuted: '#A89C8C',
  textFaint: '#6F655A',
  accent: '#E8A33D',
  accentText: '#14110F',
  danger: '#D9644A',
  success: '#7FB069',
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 40 } as const;
export const radius = { sm: 4, md: 8, lg: 16, pill: 999 } as const;

export const type = {
  display: { fontSize: 40, fontWeight: '800', letterSpacing: -1 },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  heading: { fontSize: 17, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 22 },
  small: { fontSize: 13, lineHeight: 18 },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase' },
} as const;

/** Content never grows wider than this, so grids stay readable on desktop. */
export const maxContentWidth = 1040;
