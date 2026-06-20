import type { Theme } from '../model/theme';

export const defaultLight: Theme = {
  id: 'default-light',
  name: 'Simple Light',
  colors: {
    text: '#1A1A1A',
    background: '#FFFFFF',
    textSecondary: '#5F6368',
    backgroundAlt: '#F1F3F4',
    accent1: '#1A73E8',
    accent2: '#5F6368',
    accent3: '#34A853',
    accent4: '#FBBC04',
    accent5: '#EA4335',
    accent6: '#A142F4',
    hyperlink: '#1A73E8',
    visitedHyperlink: '#681DA8',
  },
  fonts: { heading: 'Inter', body: 'Inter' },
};
