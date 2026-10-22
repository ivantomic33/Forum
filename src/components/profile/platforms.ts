import type { LucideIcon } from 'lucide-react';
import { Gamepad2, Monitor, Radio, Twitch, Youtube, Zap } from 'lucide-react';

/** Platforme sa ikonicama (F-30 — svaka ikonica ima tekstualno ime u UI-u). */
export interface PlatformMeta {
  id: string;
  name: string;
  icon: LucideIcon;
  color: string;
}

export const PLATFORMS: PlatformMeta[] = [
  { id: 'steam', name: 'Steam', icon: Gamepad2, color: '#66c0f4' },
  { id: 'discord', name: 'Discord', icon: Radio, color: '#5865f2' },
  { id: 'twitch', name: 'Twitch', icon: Twitch, color: '#9146ff' },
  { id: 'youtube', name: 'YouTube', icon: Youtube, color: '#ff0033' },
  { id: 'epic', name: 'Epic Games', icon: Zap, color: '#e2e2e2' },
  { id: 'riot', name: 'Riot Games', icon: Monitor, color: '#d13639' },
];
