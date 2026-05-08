import type { Theme } from '../model/theme';

export const defaultLight: Theme = {
  id: 'default-light',
  name: 'Simple Light',
  colors: {
    text: '#202124',
    background: '#FFFFFF',
    textSecondary: '#5F6368',
    backgroundAlt: '#F1F3F4',
    accent1: '#1A73E8',
    accent2: '#34A853',
    accent3: '#FBBC04',
    accent4: '#EA4335',
    accent5: '#673AB7',
    accent6: '#FF6D01',
    hyperlink: '#1A73E8',
    visitedHyperlink: '#7B1FA2',
  },
  fonts: { heading: 'Inter', body: 'Inter' },
};
