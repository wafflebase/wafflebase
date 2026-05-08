import type { Theme } from '../model/theme';

export const defaultDark: Theme = {
  id: 'default-dark',
  name: 'Simple Dark',
  colors: {
    text: '#E8EAED',
    background: '#202124',
    textSecondary: '#9AA0A6',
    backgroundAlt: '#303134',
    accent1: '#8AB4F8',
    accent2: '#81C995',
    accent3: '#FDD663',
    accent4: '#F28B82',
    accent5: '#C58AF9',
    accent6: '#FBBC04',
    hyperlink: '#8AB4F8',
    visitedHyperlink: '#C58AF9',
  },
  fonts: { heading: 'Inter', body: 'Inter' },
};
