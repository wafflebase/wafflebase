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
    accent2: '#9AA0A6',
    accent3: '#81C995',
    accent4: '#FDD663',
    accent5: '#F28B82',
    accent6: '#C58AF9',
    hyperlink: '#8AB4F8',
    visitedHyperlink: '#C58AF9',
  },
  fonts: { heading: 'Inter', body: 'Inter' },
};
