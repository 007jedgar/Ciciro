"use client";

import { useEffect, useState } from "react";
import { useSettings } from "@/components/SettingsProvider";
import {
  getWritingDaySnapshot,
  hydrateWritingDay,
  subscribeWritingDay,
} from "@/lib/writing-day-client";

export default function WritingMeter() {
  const { settings } = useSettings();
  const [day, setDay] = useState(getWritingDaySnapshot);

  useEffect(() => {
    void hydrateWritingDay();
    return subscribeWritingDay(() => setDay(getWritingDaySnapshot()));
  }, []);

  if (!settings.showDailyGoal) return null;

  const ratio = settings.dailyWordGoal > 0 ? Math.min(1, day.words / settings.dailyWordGoal) : 0;

  return (
    <span
      className="writing-meter"
      role="meter"
      aria-label={`${day.words} of ${settings.dailyWordGoal} words today`}
      aria-valuemin={0}
      aria-valuemax={settings.dailyWordGoal}
      aria-valuenow={Math.min(day.words, settings.dailyWordGoal)}
    >
      <span className="writing-meter-fill" style={{ width: `${ratio * 100}%` }} />
    </span>
  );
}
