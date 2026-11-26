import React, { useState } from 'react';

interface UserAvatarProps {
  name?: string | null;
  avatarUrl?: string | null;
  sizeClassName?: string;
  className?: string;
}

export const UserAvatar: React.FC<UserAvatarProps> = ({
  name,
  avatarUrl,
  sizeClassName = 'w-9 h-9',
  className = 'rounded-full ring-1 ring-primary',
}) => {
  const [hasError, setHasError] = useState(false);

  const initials = (name || 'VC')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() || '')
    .join('') || 'VC';

  if (!avatarUrl || hasError) {
    return (
      <div
        aria-hidden="true"
        className={`${sizeClassName} ${className} bg-primary/10 text-primary font-semibold text-xs flex items-center justify-center shrink-0 select-none`}
      >
        {initials}
      </div>
    );
  }

  return (
    <img
      src={avatarUrl}
      alt={name ? `Avatar de ${name}` : 'Avatar de usuario'}
      referrerPolicy="no-referrer"
      onError={() => setHasError(true)}
      className={`${sizeClassName} ${className} object-cover shrink-0`}
    />
  );
};
