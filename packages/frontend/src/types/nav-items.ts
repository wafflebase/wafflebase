export type NavItem = {
  title: string;
  url: string;
  icon: React.ComponentType;
  /** A count shown at the row's end (unread chat messages); hidden at 0. */
  badge?: number;
};
