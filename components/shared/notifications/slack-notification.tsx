"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

export default function SlackNotification({
  shouldNotify,
  onClick,
}: {
  shouldNotify: boolean;
  onClick: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const handleClick = async () => {
    setIsOpen(false);
    if (onClick) {
      onClick();
    }
  };

  useEffect(() => {
    if (shouldNotify) {
      setIsOpen(true);
    }
  }, [shouldNotify]);

  return (
    <>
      <div
        className={`fixed z-[1000000] top-16 transition-transform duration-500 ease-in-out right-0 bg-surface-ink-900 border border-surface-ink-700/70 p-4 rounded-[18px] shadow-[0_16px_40px_rgba(5,8,15,0.45)] mr-4 ${isOpen ? "translate-x-0" : "translate-x-[400px]"}`}
        onClick={handleClick}
      >
        <div className="flex flex-row items-center max-w-xs cursor-pointer">
          <div className="flex min-w-16 mr-2 mt-1">
            <Image
              className="w-16 h-16"
              src="/images/slack_logo_icon.png"
              alt="Slack Logo"
              width={64}
              height={64}
            />
          </div>
          <div className="flex flex-col">
            <h1 className="text-sm font-bold text-ink-100">
              New message in: #coach-gtm
            </h1>
            <span className="text-sm text-ink-300">
              {`@CoachGTM: Your meeting prep for Pied Piper < > WindFlow Dynamics is ready! Meeting starts in 30 minutes`}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
