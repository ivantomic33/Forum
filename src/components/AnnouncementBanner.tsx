import { useQuery } from '@tanstack/react-query';
import { AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';

export default function AnnouncementBanner() {
  const [dismissed, setDismissed] = useState(false);

  const { data } = useQuery({
    queryKey: ['public-settings'],
    queryFn: () => api.admin.getPublicSettings(),
    refetchInterval: 60_000,
  });

  const announcement = data?.settings?.announcement;

  if (!announcement?.active || !announcement.message || dismissed) {
    return null;
  }

  const toneConfig = {
    info: {
      bg: 'bg-blue-950/80 border-blue-500/40 text-blue-200',
      icon: <Info size={16} className="text-blue-400 flex-shrink-0" />,
    },
    warning: {
      bg: 'bg-amber-950/80 border-amber-500/40 text-amber-200',
      icon: <AlertTriangle size={16} className="text-amber-400 flex-shrink-0" />,
    },
    danger: {
      bg: 'bg-red-950/80 border-red-500/40 text-red-200',
      icon: <AlertCircle size={16} className="text-red-400 flex-shrink-0" />,
    },
  }[announcement.tone || 'info'];

  return (
    <div
      role="alert"
      className={`relative z-40 flex items-center justify-between border-b px-4 py-2.5 text-xs sm:text-sm font-medium backdrop-blur-md transition ${toneConfig.bg}`}
    >
      <div className="container mx-auto flex items-center justify-center gap-2 pr-6">
        {toneConfig.icon}
        <span>{announcement.message}</span>
        {announcement.link && (
          <a
            href={announcement.link}
            className="ml-2 font-semibold underline underline-offset-2 hover:opacity-80"
          >
            Saznaj više →
          </a>
        )}
      </div>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Zatvori obaveštenje"
        className="opacity-70 hover:opacity-100 transition p-1"
      >
        <X size={15} />
      </button>
    </div>
  );
}
