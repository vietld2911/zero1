import type { BadgeProps } from '@zero1/ui';

export type Team = 'MANAGEMENT' | 'SALES' | 'OPERATIONS' | 'ACADEMIC';

/** Team của cơ sở (docs/roles-permissions.md §1). Quản lý = ADMIN / AM / CM. */
export const TEAMS: Record<Team, { label: string; tone: NonNullable<BadgeProps['tone']> }> = {
  MANAGEMENT: { label: 'Quản lý', tone: 'neutral' },
  SALES: { label: 'Kinh doanh', tone: 'brand' },
  OPERATIONS: { label: 'Vận hành', tone: 'warning' },
  ACADEMIC: { label: 'Học thuật', tone: 'success' },
};
export const TEAM_ORDER: Team[] = ['MANAGEMENT', 'SALES', 'OPERATIONS', 'ACADEMIC'];
