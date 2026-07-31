/*
 * Jadges profile badges for Vencord
 * Displays approved Jadges badges in Discord's native User Badges row.
 */

import { addProfileBadge, BadgePosition, type BadgeUserArgs, type ProfileBadge, removeProfileBadge } from "@api/Badges";
import { Settings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

interface JadgesBadge {
    name?: string;
    tooltip?: string;
    badge: string;
}

type JadgesResponse = Record<string, JadgesBadge[]>;

const DEFAULT_API_URL = "https://jadges.onrender.com/badges.json";
const REFRESH_INTERVAL = 60_000;

let badgeData: JadgesResponse = {};
let refreshTimer: ReturnType<typeof setInterval> | undefined;

function normalizeApiUrl(value: unknown): string {
    const url = typeof value === "string" ? value.trim() : "";
    return url || DEFAULT_API_URL;
}

async function refreshBadges(noCache = false): Promise<void> {
    const apiUrl = normalizeApiUrl(Settings.plugins.JadgesBadges?.apiUrl);

    try {
        const response = await fetch(apiUrl, {
            cache: noCache ? "no-store" : "default"
        });

        if (!response.ok) {
            throw new Error(`Jadges API returned HTTP ${response.status}`);
        }

        const data = await response.json();
        if (!data || typeof data !== "object" || Array.isArray(data)) {
            throw new TypeError("Jadges API returned an invalid response");
        }

        badgeData = data as JadgesResponse;
    } catch (error) {
        console.error("[JadgesBadges] Failed to fetch badges:", error);
    }
}

function getBadges({ userId }: BadgeUserArgs): ProfileBadge[] {
    const badges = badgeData[userId];
    if (!Array.isArray(badges)) return [];

    return badges
        .filter(badge => badge && typeof badge.badge === "string" && badge.badge.startsWith("https://"))
        .map((badge, index) => {
            const description = badge.tooltip || badge.name || "Jadges Badge";

            return {
                key: `jadges-${userId}-${index}-${description}`,
                description,
                image: badge.badge,
                position: BadgePosition.END,
                props: {
                    alt: description,
                    style: {
                        width: "20px",
                        height: "20px",
                        objectFit: "contain"
                    }
                }
            } satisfies ProfileBadge;
        });
}

const profileBadge: ProfileBadge = {
    getBadges,
    position: BadgePosition.END
};

export default definePlugin({
    name: "JadgesBadges",
    description: "Displays approved Jadges badges in Discord's native profile badge row.",
    authors: [{ name: "Jaycord", id: 0n }],

    options: {
        apiUrl: {
            type: OptionType.STRING,
            description: "Full Jadges badges.json API URL",
            default: DEFAULT_API_URL,
            restartNeeded: true
        }
    },

    async start() {
        addProfileBadge(profileBadge);
        await refreshBadges(true);

        clearInterval(refreshTimer);
        refreshTimer = setInterval(() => void refreshBadges(true), REFRESH_INTERVAL);
    },

    stop() {
        removeProfileBadge(profileBadge);
        clearInterval(refreshTimer);
        refreshTimer = undefined;
        badgeData = {};
    }
});
