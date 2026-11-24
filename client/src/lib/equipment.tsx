import React from 'react';

export type EquipmentId =
  | 'dumbbells'
  | 'mat'
  | 'gym_ball'
  | 'resistance_bands'
  | 'mini_bands'
  | 'pilates_ball'
  | 'pilates_bar'
  | 'kettlebell'
  | 'barbell'
  | 'medicine_ball'
  | 'ankle_weights'
  | 'jump_rope'
  | 'ab_roller'
  | 'pull_up_bar'
  | 'weighted_hula_hoop'
  | 'trampoline'
  | 'treadmill'
  | 'exercise_bike'
  | 'rowing_machine'
  | 'step'
  | 'bench'
  | 'chair'
  | 'yoga_block'
  | 'foam_roller'
  | 'sliders'
  | 'no_equipment';

export type EquipmentItem = {
  id: EquipmentId;
  label: string;
  icon: React.ReactNode;
};

const iconProps = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export const EQUIPMENT_ITEMS: EquipmentItem[] = [
  {
    id: 'dumbbells',
    label: 'Dumbbells',
    icon: (
      <svg {...iconProps}>
        <rect x="2" y="9" width="3" height="6" rx="1" />
        <rect x="19" y="9" width="3" height="6" rx="1" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    ),
  },
  {
    id: 'mat',
    label: 'Mat',
    icon: (
      <svg {...iconProps}>
        <rect x="4" y="8" width="16" height="8" rx="2" />
        <path d="M7 11h10M7 13h10" />
      </svg>
    ),
  },
  {
    id: 'gym_ball',
    label: 'Gym Ball',
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="12" r="8" />
        <ellipse cx="12" cy="12" rx="8" ry="3" />
        <path d="M12 4v16" />
      </svg>
    ),
  },
  {
    id: 'resistance_bands',
    label: 'Resistance Bands',
    icon: (
      <svg {...iconProps}>
        <path d="M4 8c4 0 4 8 8 8s4-8 8-8" />
        <path d="M4 16c4 0 4-8 8-8s4 8 8 8" />
      </svg>
    ),
  },
  {
    id: 'mini_bands',
    label: 'Mini Bands',
    icon: (
      <svg {...iconProps}>
        <ellipse cx="12" cy="12" rx="8" ry="4.5" />
        <ellipse cx="12" cy="12" rx="5" ry="2" />
      </svg>
    ),
  },
  {
    id: 'pilates_ball',
    label: 'Pilates Ball',
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="13" r="5" />
        <path d="M9 8l6-2M15 18l-2 2" />
      </svg>
    ),
  },
  {
    id: 'pilates_bar',
    label: 'Pilates Bar',
    icon: (
      <svg {...iconProps}>
        <line x1="3" y1="12" x2="21" y2="12" />
        <rect x="1" y="10" width="3" height="4" rx="0.5" />
        <rect x="20" y="10" width="3" height="4" rx="0.5" />
      </svg>
    ),
  },
  {
    id: 'kettlebell',
    label: 'Kettlebell',
    icon: (
      <svg {...iconProps}>
        <path d="M12 3a3 3 0 0 1 3 3v1" />
        <path d="M9 7h6" />
        <path d="M8 10c-2 1-3 3-3 5.5a7 7 0 0 0 14 0C19 13 18 11 16 10" />
      </svg>
    ),
  },
  {
    id: 'barbell',
    label: 'Barbell',
    icon: (
      <svg {...iconProps}>
        <line x1="2" y1="12" x2="22" y2="12" />
        <rect x="4" y="8.5" width="2.5" height="7" rx="0.8" />
        <rect x="7.5" y="10" width="2" height="4" rx="0.6" />
        <rect x="17.5" y="8.5" width="2.5" height="7" rx="0.8" />
        <rect x="14.5" y="10" width="2" height="4" rx="0.6" />
      </svg>
    ),
  },
  {
    id: 'medicine_ball',
    label: 'Medicine Ball',
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="12" r="8" />
        <path d="M4.5 9.5h15M4.5 14.5h15" />
      </svg>
    ),
  },
  {
    id: 'ankle_weights',
    label: 'Ankle Weights',
    icon: (
      <svg {...iconProps}>
        <path d="M9 3v10l-4 4v3h8" />
        <rect x="7" y="9" width="8" height="4" rx="1.5" />
      </svg>
    ),
  },
  {
    id: 'jump_rope',
    label: 'Jump Rope',
    icon: (
      <svg {...iconProps}>
        <rect x="3" y="3" width="3" height="7" rx="1.2" />
        <rect x="18" y="3" width="3" height="7" rx="1.2" />
        <path d="M4.5 10c0 9 15 9 15 0" />
      </svg>
    ),
  },
  {
    id: 'ab_roller',
    label: 'Ab Roller',
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="12" r="5" />
        <path d="M3 12h4M17 12h4" />
        <circle cx="12" cy="12" r="1.5" />
      </svg>
    ),
  },
  {
    id: 'pull_up_bar',
    label: 'Pull-up Bar',
    icon: (
      <svg {...iconProps}>
        <path d="M3 5h18" />
        <path d="M5 3v4M19 3v4" />
        <path d="M9 5v4M15 5v4" />
        <circle cx="12" cy="12" r="2" />
        <path d="M12 14v6M9 9l3 3 3-3" />
      </svg>
    ),
  },
  {
    id: 'weighted_hula_hoop',
    label: 'Weighted Hula Hoop',
    icon: (
      <svg {...iconProps}>
        <ellipse cx="12" cy="13" rx="9" ry="3.5" />
        <circle cx="19" cy="16" r="1.4" />
        <circle cx="12" cy="5" r="2" />
      </svg>
    ),
  },
  {
    id: 'trampoline',
    label: 'Trampoline',
    icon: (
      <svg {...iconProps}>
        <ellipse cx="12" cy="10" rx="9" ry="3" />
        <path d="M5 12l-1 7M19 12l1 7M12 13v6" />
      </svg>
    ),
  },
  {
    id: 'treadmill',
    label: 'Treadmill',
    icon: (
      <svg {...iconProps}>
        <path d="M3 18h15l3-3" />
        <path d="M16 18l2-11h2" />
        <path d="M5 21h12" />
      </svg>
    ),
  },
  {
    id: 'exercise_bike',
    label: 'Exercise Bike',
    icon: (
      <svg {...iconProps}>
        <circle cx="7" cy="16" r="4" />
        <path d="M7 16l5-7h4M12 9l-1-4h-3M16 9v11" />
        <path d="M13 20h6" />
      </svg>
    ),
  },
  {
    id: 'rowing_machine',
    label: 'Rowing Machine',
    icon: (
      <svg {...iconProps}>
        <path d="M2 18h20" />
        <circle cx="19" cy="14" r="3" />
        <path d="M5 18v-3h7M9 15l-2-5h4" />
      </svg>
    ),
  },
  {
    id: 'step',
    label: 'Step',
    icon: (
      <svg {...iconProps}>
        <rect x="3" y="9" width="18" height="3.5" rx="1" />
        <path d="M6 12.5V16M18 12.5V16" />
      </svg>
    ),
  },
  {
    id: 'bench',
    label: 'Bench',
    icon: (
      <svg {...iconProps}>
        <rect x="3" y="8" width="18" height="3" rx="1.2" />
        <path d="M6 11v4M18 11v4" />
        <path d="M4 19h4M16 19h4" />
        <path d="M6 15l-2 4M18 15l2 4" />
      </svg>
    ),
  },
  {
    id: 'chair',
    label: 'Chair',
    icon: (
      <svg {...iconProps}>
        <path d="M7 3v10h10" />
        <path d="M7 13v8M17 13v8" />
        <path d="M7 8h7" />
      </svg>
    ),
  },
  {
    id: 'yoga_block',
    label: 'Yoga Block',
    icon: (
      <svg {...iconProps}>
        <path d="M4 9l8-4 8 4v6l-8 4-8-4z" />
        <path d="M4 9l8 4 8-4M12 13v6" />
      </svg>
    ),
  },
  {
    id: 'foam_roller',
    label: 'Foam Roller',
    icon: (
      <svg {...iconProps}>
        <ellipse cx="5" cy="12" rx="2" ry="4" />
        <path d="M5 8h14M5 16h14" />
        <ellipse cx="19" cy="12" rx="2" ry="4" />
      </svg>
    ),
  },
  {
    id: 'sliders',
    label: 'Sliders',
    icon: (
      <svg {...iconProps}>
        <ellipse cx="7" cy="14" rx="4.5" ry="2" />
        <ellipse cx="17" cy="14" rx="4.5" ry="2" />
        <path d="M3 10h4M17 10h4" />
      </svg>
    ),
  },
  {
    id: 'no_equipment',
    label: 'No Equipment',
    icon: (
      <svg {...iconProps}>
        <rect x="2.5" y="9.5" width="3" height="5" rx="1" />
        <rect x="18.5" y="9.5" width="3" height="5" rx="1" />
        <line x1="5.5" y1="12" x2="18.5" y2="12" />
        <line x1="4" y1="20" x2="20" y2="4" />
      </svg>
    ),
  },
];

const equipmentMap = new Map(EQUIPMENT_ITEMS.map(item => [item.id, item]));

export function getEquipmentItem(id: string): EquipmentItem | undefined {
  return equipmentMap.get(id as EquipmentId);
}

export function EquipmentIcon({ id, size = 18 }: { id: string; size?: number }) {
  const item = getEquipmentItem(id);
  if (!item) return null;
  return (
    <span
      title={item.label}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size }}
    >
      {item.icon}
    </span>
  );
}
