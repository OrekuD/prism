import { ProjectDetailedRequest, ProjectDetailedResource } from "@prism/types";
import { Session } from "../models/Session";

export function groupSessionsByDateAndPlatform(
  sessions: Session[],
  duration: ProjectDetailedRequest["duration"],
): ProjectDetailedResource["analytics"]["summary"] {
  const countMap = new Map<
    string,
    { mobileCount: number; desktopCount: number }
  >();

  // Get the date range
  const endDate = new Date();
  const startDate = new Date(endDate);

  switch (duration) {
    case "24-hours":
      startDate.setHours(startDate.getHours() - 24);
      break;
    case "seven-days":
      startDate.setDate(startDate.getDate() - 7);
      break;
    case "two-weeks":
      startDate.setDate(startDate.getDate() - 14);
      break;
    case "one-month":
      startDate.setMonth(startDate.getMonth() - 1);
      break;
    case "one-year":
      startDate.setFullYear(startDate.getFullYear() - 1);
      break;
    default:
      startDate.setMonth(startDate.getMonth() - 3);
  }

  // Initialize the map with all dates in the range
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    countMap.set(d.toISOString().split("T")[0], {
      mobileCount: 0,
      desktopCount: 0,
    });
  }

  // Count sessions for each date and platform
  sessions.forEach((session) => {
    const date = session.created_at.split(" ")[0]; // This extracts YYYY-MM-DD
    if (new Date(date) >= startDate && new Date(date) <= endDate) {
      const counts = countMap.get(date) || { mobileCount: 0, desktopCount: 0 };
      if (session.is_mobile === 1) {
        counts.mobileCount++;
      } else {
        counts.desktopCount++;
      }
      countMap.set(date, counts);
    }
  });

  // Convert map to array of objects
  return Array.from(countMap, ([date, counts]) => ({
    date,
    mobile: counts.mobileCount,
    desktop: counts.desktopCount,
  }));
}
